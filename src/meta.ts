import * as vscode from 'vscode';

const CLIENT_ID = '1031625952748946';
const AUTH_URL = 'https://auth.meta.com/oidc/device';
const API_URL = 'https://api.meta.ai';
const HEADERS = { Accept: 'application/json', 'x-api-version': '1.0.0' };
const TOKEN_ERRORS: Record<string, string> = {
  access_denied: 'Sign-in was denied in the browser.',
  expired_token: 'The sign-in code expired. Try again.',
};

export interface Session {
  apiKey: string;
  email?: string;
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval: number;
  expires_in: number;
}

export interface MuseMeta {
  is_hidden?: boolean;
  tool_call?: boolean;
  modalities?: { input?: string[] };
  limit?: { context?: number; output?: number };
  options?: { reasoningEffort?: string };
  variants?: Record<string, { reasoningEffort?: string }>;
}

export interface ApiModel {
  id: string;
  metadata?: { 'muse-code'?: MuseMeta };
}

export interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export interface ChatChunk {
  choices?: { delta?: { content?: string; tool_calls?: ToolCallDelta[] } }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface KeyResponse {
  api_key?: string;
  is_subs_active?: boolean;
  action_url?: string;
  require_payment_action_url?: string;
  user_email?: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    detail = '',
  ) {
    super(`Muse Code request failed (HTTP ${status}). ${detail.slice(0, 300)}`.trim());
  }
}

function headers(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...HEADERS, Authorization: `Bearer ${apiKey}`, ...extra };
}

function form(params: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
    signal: AbortSignal.timeout(25_000),
  };
}

export async function requestDeviceCode(): Promise<DeviceCode> {
  const res = await fetch(`${AUTH_URL}/authorization/`, form({}));
  const body = (await res.json().catch(() => ({}))) as Partial<DeviceCode>;
  if (!res.ok || !body.device_code || !body.user_code || !body.verification_uri) {
    throw new HttpError(res.status, 'Could not start sign-in.');
  }
  return { interval: 5, expires_in: 600, ...body } as DeviceCode;
}

interface TokenReply {
  access_token?: string;
  error?: string;
}

// The token endpoint answers "still waiting" with HTTP 400; network blips count as waiting too.
function pollOnce(deviceCode: string): Promise<TokenReply> {
  const grant = 'urn:ietf:params:oauth:grant-type:device_code';
  return fetch(`${AUTH_URL}/token/`, form({ grant_type: grant, device_code: deviceCode }))
    .then((res) => res.json() as Promise<TokenReply>)
    .catch(() => ({}));
}

export async function pollAccessToken(device: DeviceCode, cancel: vscode.CancellationToken): Promise<string> {
  let interval = Math.max(1, device.interval);
  const deadline = Date.now() + device.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    if (cancel.isCancellationRequested) throw new vscode.CancellationError();
    const { access_token, error = 'authorization_pending' } = await pollOnce(device.device_code);
    if (access_token) return access_token;
    if (error === 'slow_down') interval += 5;
    else if (error !== 'authorization_pending') throw new Error(TOKEN_ERRORS[error] ?? `Sign-in failed: ${error}.`);
  }
  throw new Error('Sign-in timed out. Try again.');
}

// Mints the account-bound key billed to the subscription. Rate-limited, so only on sign-in.
export async function mintSession(accessToken: string): Promise<Session> {
  const res = await fetch(`${API_URL}/muse-code/key`, {
    method: 'POST',
    headers: headers(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ onboard: true }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  const body = (await res.json()) as KeyResponse;
  if (!body.api_key || body.is_subs_active === false) {
    const action = body.action_url ?? body.require_payment_action_url ?? '';
    throw new Error(`An active Muse Code subscription is required. ${action}`.trim());
  }
  return { apiKey: body.api_key, email: body.user_email };
}

export async function fetchModels(apiKey: string): Promise<ApiModel[]> {
  const res = await fetch(`${API_URL}/muse-code/models`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new HttpError(res.status);
  const body = (await res.json()) as { data?: ApiModel[] };
  return body.data ?? [];
}

export async function* streamChat(apiKey: string, request: object, signal: AbortSignal): AsyncGenerator<ChatChunk> {
  const res = await fetch(`${API_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: headers(apiKey, { Accept: 'text/event-stream', 'Content-Type': 'application/json' }),
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok || !res.body) throw new HttpError(res.status, await res.text());
  let buffer = '';
  for await (const text of res.body.pipeThrough(new TextDecoderStream())) {
    const lines = (buffer + text).split('\n');
    buffer = lines.pop() ?? '';
    yield* parseEvents(lines);
  }
}

function* parseEvents(lines: string[]): Generator<ChatChunk> {
  for (const line of lines) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (data && data !== '[DONE]') yield JSON.parse(data) as ChatChunk;
  }
}
