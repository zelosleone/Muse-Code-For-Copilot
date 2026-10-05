import type * as vscode from 'vscode';
import type { ApiModel, MuseMeta } from './meta.js';

export type MuseModel = vscode.LanguageModelChatInformation & {
  readonly isBYOK: true;
  readonly maxContextWindowTokens: number;
  readonly configurationSchema?: object;
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
      maxInputTokens: meta.limit.context,
      maxOutputTokens: meta.limit.output,
      maxContextWindowTokens: meta.limit.context,
      capabilities: { toolCalling: true, imageInput: meta.modalities?.input?.includes('image') === true },
      isBYOK: true,
      configurationSchema: effortSchema(meta),
    },
  ];
}

function isUsable(meta: MuseMeta | undefined): meta is UsableMeta {
  return Boolean(meta?.limit?.context && meta.limit.output && !meta.is_hidden && meta.tool_call !== false);
}

// Reasoning effort as an in-picker option, built from the model's own live variants.
function effortSchema(meta: MuseMeta): object | undefined {
  const variants = Object.entries(meta.variants ?? {});
  if (variants.length === 0) return undefined;
  const efforts = variants.map(([name, variant]) => variant.reasoningEffort ?? name);
  return {
    properties: {
      reasoningEffort: {
        type: 'string',
        title: 'Reasoning Effort',
        enum: efforts,
        enumItemLabels: variants.map(([name]) => titleCase(name)),
        default: efforts.find((effort) => effort === meta.options?.reasoningEffort) ?? efforts[0],
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
