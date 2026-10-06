import * as vscode from 'vscode';
import type { ToolCallDelta } from './meta.js';

interface ImagePart {
  type: 'image_url';
  image_url: { url: string };
}

type Content = string | null | ({ type: 'text'; text: string } | ImagePart)[];

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: 'developer' | 'user' | 'assistant' | 'tool';
  content: Content;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface Parts {
  texts: string[];
  images: ImagePart[];
  toolCalls: ToolCall[];
  toolResults: OpenAIMessage[];
}

export interface PendingCall {
  id?: string;
  name: string;
  args: string;
}

// Copilot sends its system prompt with the proposed System role, which the stable typings lack.
// Meta takes instructions as `developer` (it treats `system` the same, but recommends `developer`).
const SYSTEM_ROLE = 3 as vscode.LanguageModelChatMessageRole;

export function toOpenAIMessages(message: vscode.LanguageModelChatRequestMessage): OpenAIMessage[] {
  const { texts, images, toolCalls, toolResults } = collect(message.content);
  const role = roleOf(message.role);
  const content = toContent(texts.join('\n'), images);
  const calls = toolCalls.length > 0 ? { tool_calls: toolCalls } : {};
  const main: OpenAIMessage[] = content !== null || toolCalls.length > 0 ? [{ role, content, ...calls }] : [];
  // Tool results must directly follow the assistant message that requested them.
  return [...toolResults, ...main];
}

export function toOpenAITool(tool: vscode.LanguageModelChatTool): object {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema ?? {} },
  };
}

export function appendToolCall(calls: Map<number, PendingCall>, delta: ToolCallDelta): void {
  const { index = 0, id, function: fn = {} } = delta;
  const call = calls.get(index) ?? { name: '', args: '' };
  calls.set(index, { id: id ?? call.id, name: call.name + (fn.name ?? ''), args: call.args + (fn.arguments ?? '') });
}

export function toToolCallParts(calls: Map<number, PendingCall>): vscode.LanguageModelToolCallPart[] {
  return [...calls].map(
    ([index, call]) => new vscode.LanguageModelToolCallPart(call.id ?? `call_${index}`, call.name, parseArgs(call.args)),
  );
}

function roleOf(role: vscode.LanguageModelChatMessageRole): OpenAIMessage['role'] {
  if (role === vscode.LanguageModelChatMessageRole.User) return 'user';
  return role === SYSTEM_ROLE ? 'developer' : 'assistant';
}

function collect(content: readonly unknown[]): Parts {
  const parts: Parts = { texts: [], images: [], toolCalls: [], toolResults: [] };
  for (const part of content) {
    if (part instanceof vscode.LanguageModelTextPart) parts.texts.push(part.value);
    else if (part instanceof vscode.LanguageModelToolCallPart) parts.toolCalls.push(toToolCall(part));
    else if (part instanceof vscode.LanguageModelToolResultPart) parts.toolResults.push(toToolResult(part));
    else if (isImage(part)) parts.images.push(toImage(part));
  }
  return parts;
}

function toContent(text: string, images: ImagePart[]): Content {
  if (images.length === 0) return text || null;
  return text ? [{ type: 'text', text }, ...images] : images;
}

function isImage(part: unknown): part is vscode.LanguageModelDataPart {
  return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}

function toImage(part: vscode.LanguageModelDataPart): ImagePart {
  const url = `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`;
  return { type: 'image_url', image_url: { url } };
}

function toToolCall(part: vscode.LanguageModelToolCallPart): ToolCall {
  return { id: part.callId, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.input) } };
}

function toToolResult(part: vscode.LanguageModelToolResultPart): OpenAIMessage {
  const text = part.content
    .filter((item) => item instanceof vscode.LanguageModelTextPart)
    .map((item) => item.value)
    .join('\n');
  return { role: 'tool', tool_call_id: part.callId, content: text || JSON.stringify(part.content) };
}

function parseArgs(args: string): object {
  try {
    return JSON.parse(args || '{}') as object;
  } catch {
    return {};
  }
}
