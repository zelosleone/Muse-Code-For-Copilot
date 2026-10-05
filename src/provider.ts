import * as vscode from 'vscode';
import type { Auth } from './auth.js';
import { appendToolCall, toOpenAIMessages, toOpenAITool, toToolCallParts, type PendingCall } from './convert.js';
import { fetchModels, HttpError, streamChat, type ChatChunk } from './meta.js';
import { toMuseModels, type MuseModel } from './models.js';

const MODELS_KEY = 'museCode.models';
const CHARS_PER_TOKEN_KEY = 'museCode.charsPerToken';

type Options = vscode.ProvideLanguageModelChatResponseOptions & {
  readonly modelConfiguration?: { readonly reasoningEffort?: string };
  readonly configuration?: { readonly reasoningEffort?: string };
};

type Usage = NonNullable<ChatChunk['usage']>;

interface Turn {
  model: MuseModel;
  chars: number;
  calls: Map<number, PendingCall>;
  progress: vscode.Progress<vscode.LanguageModelResponsePart>;
}

export class MuseChatProvider implements vscode.LanguageModelChatProvider<MuseModel> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changed.event;
  private models: MuseModel[];
  private charsPerToken: number;

  constructor(
    private readonly state: vscode.Memento,
    private readonly auth: Auth,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.models = state.get<MuseModel[]>(MODELS_KEY, []);
    this.charsPerToken = state.get(CHARS_PER_TOKEN_KEY, 4);
  }

  async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions): Promise<MuseModel[]> {
    if (await this.auth.getSession()) return this.models;
    if (!options.silent) void this.auth.signIn();
    return [];
  }

  async provideLanguageModelChatResponse(
    model: MuseModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: Options,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const session = await this.auth.getSession();
    if (!session) throw new Error('Not signed in. Run "Muse Code: Sign In".');
    const request = buildRequest(model, messages, options);
    const turn: Turn = { model, chars: payloadChars(request), calls: new Map(), progress };
    const abort = new AbortController();
    const cancel = token.onCancellationRequested(() => abort.abort());
    try {
      for await (const chunk of streamChat(session.apiKey, request, abort.signal)) this.onChunk(chunk, turn);
      for (const part of toToolCallParts(turn.calls)) progress.report(part);
    } catch (error) {
      if (!token.isCancellationRequested) throw await this.signOutIfExpired(error);
    } finally {
      cancel.dispose();
    }
  }

  // Copilot calls this for every key and string of every tool schema, so round instead of ceil.
  async provideTokenCount(_model: MuseModel, text: string | vscode.LanguageModelChatRequestMessage): Promise<number> {
    const chars = typeof text === 'string' ? text.length : payloadChars(toOpenAIMessages(text));
    return Math.max(1, Math.round(chars / this.charsPerToken));
  }

  async refresh(): Promise<void> {
    const session = await this.auth.getSession();
    if (!session) return;
    try {
      this.setModels(toMuseModels(await fetchModels(session.apiKey)));
    } catch (error) {
      this.log.warn(`Model refresh failed: ${await this.signOutIfExpired(error)}`);
    }
  }

  sessionChanged(): void {
    this.changed.fire();
    void this.refresh();
  }

  // Unchanged catalogs keep the same objects, so open picker menus stay put.
  private setModels(models: MuseModel[]): void {
    if (JSON.stringify(models) === JSON.stringify(this.models)) return;
    this.models = models;
    void this.state.update(MODELS_KEY, models);
    this.changed.fire();
  }

  private onChunk(chunk: ChatChunk, turn: Turn): void {
    const delta = firstDelta(chunk);
    if (delta.content) turn.progress.report(new vscode.LanguageModelTextPart(delta.content));
    for (const call of delta.tool_calls ?? []) appendToolCall(turn.calls, call);
    if (chunk.usage) this.recordUsage(chunk.usage, turn);
  }

  private recordUsage(usage: Usage, turn: Turn): void {
    // Copilot reads this data part to drive its context window indicator.
    turn.progress.report(vscode.LanguageModelDataPart.json(usage, 'usage'));
    const ratio = Math.min(12, Math.max(1, turn.chars / Math.max(1, usage.prompt_tokens)));
    this.charsPerToken = this.charsPerToken * 0.7 + ratio * 0.3;
    void this.state.update(CHARS_PER_TOKEN_KEY, this.charsPerToken);
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    this.log.info(`${turn.model.id}: ${usage.prompt_tokens} prompt (${cached} cached), ${usage.completion_tokens} completion`);
  }

  private async signOutIfExpired(error: unknown): Promise<unknown> {
    if (!(error instanceof HttpError) || error.status !== 401) return error;
    await this.auth.signOut();
    return new Error('Muse Code sign-in expired. Run "Muse Code: Sign In".');
  }
}

function buildRequest(model: MuseModel, messages: readonly vscode.LanguageModelChatRequestMessage[], options: Options) {
  const tools = (options.tools ?? []).map(toOpenAITool);
  return {
    model: model.id,
    messages: messages.flatMap(toOpenAIMessages),
    stream: true,
    stream_options: { include_usage: true },
    prompt_cache_key: `muse-code-copilot:${model.id}`,
    reasoning_effort: options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort,
    // Meta rejects any tool_choice other than "auto".
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
  };
}

// Everything Meta tokenizes (messages and tools), minus image data, which is billed as image tokens.
function payloadChars(value: unknown): number {
  return JSON.stringify(value, (key, item: unknown) => (key === 'image_url' ? '' : item)).length;
}

function firstDelta(chunk: ChatChunk): NonNullable<NonNullable<ChatChunk['choices']>[number]['delta']> {
  return chunk.choices?.[0]?.delta ?? {};
}
