import type * as vscode from 'vscode';
import type { ApiModel, MuseMeta } from './meta.js';

interface EffortSchema {
  properties: { reasoningEffort: { enum: string[]; default: string } & Record<string, unknown> };
}

export type MuseModel = vscode.LanguageModelChatInformation & {
  readonly isBYOK: true;
  readonly maxContextWindowTokens: number;
  readonly configurationSchema?: EffortSchema;
};

type UsableMeta = MuseMeta & { limit: { context: number; output: number } };

export function toMuseModels(models: ApiModel[]): MuseModel[] {
  return models.flatMap(toMuseModel);
}

function toMuseModel({ id, metadata }: ApiModel): MuseModel[] {
  const meta = metadata?.['muse-code'];
  if (!isUsable(meta)) return [];
  return [
    {
      id,
      name: titleCase(id),
      family: id.split('-').slice(0, 2).join('-'),
      version: id,
      ...tokenLimits(meta.limit.context, meta.limit.output),
      capabilities: { toolCalling: true, imageInput: meta.modalities?.input?.includes('image') === true },
      isBYOK: true,
      configurationSchema: effortSchema(meta),
    },
  ];
}

function isUsable(meta: MuseMeta | undefined): meta is UsableMeta {
  return Boolean(meta?.limit?.context && meta.limit.output && !meta.is_hidden && meta.tool_call !== false);
}

// Copilot's own BYOK convention: the prompt budget is the window minus the output reservation.
function tokenLimits(context: number, output: number) {
  const maxOutputTokens = Math.min(output, context);
  return { maxContextWindowTokens: context, maxOutputTokens, maxInputTokens: Math.max(0, context - maxOutputTokens) };
}

// Reasoning effort as an in-picker option, built only from the model's own live variants.
// Without a live default, 'auto' sends nothing and lets the API decide.
function effortSchema(meta: MuseMeta): EffortSchema | undefined {
  const variants = Object.entries(meta.variants ?? {});
  if (variants.length === 0) return undefined;
  const efforts = variants.map(([name, variant]) => variant.reasoningEffort ?? name);
  const labels = variants.map(([name]) => titleCase(name));
  const liveDefault = efforts.find((effort) => effort === meta.options?.reasoningEffort);
  return {
    properties: {
      reasoningEffort: {
        type: 'string',
        title: 'Reasoning Effort',
        enum: liveDefault ? efforts : ['auto', ...efforts],
        enumItemLabels: liveDefault ? labels : ['Auto', ...labels],
        default: liveDefault ?? 'auto',
        group: 'navigation',
      },
    },
  };
}

function titleCase(id: string): string {
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
