// Unified error semantics for both generated result shapes.
//
// The SDK defaults to `throwOnError: false`: operations resolve to
// `{ data, error, response, … }`. With `throwOnError: true` they throw axios
// errors instead. Both shapes funnel into `JiraApiError`:
//   - `throwIfJiraError(result)` — bridge for the default returning shape.
//   - `toJiraApiError(error)` — normalizer for the throwing shape.
//
// Retry policy: only 429 / 502 / 503 / 504 and network failures are retried —
// never 400 / 401 / 403 / 404 / 500. `Retry-After` (seconds or HTTP date) is
// honored on 429.

export const RETRYABLE_STATUS_CODES: readonly number[] = [429, 502, 503, 504];

/**
 * Request header names whose values are credentials. Axios errors carry the
 * live request config (including these headers), so attaching one untouched
 * as `cause` would expose credentials to anything serializing cause chains
 * (deep logs, error aggregators). Compared case-insensitively.
 */
const SENSITIVE_HEADERS: ReadonlySet<string> = new Set(['authorization', 'proxy-authorization']);

/** Sentinel replacing redacted credential values on a stored `cause`. */
export const REDACTED_CREDENTIAL = '[REDACTED]';

/**
 * Return `error` with credential-bearing request headers redacted.
 *
 * Values without a request config pass through untouched (same reference).
 * Otherwise a structural clone is returned — the caller's objects are never
 * mutated — with every live config redacted. Two locations are covered: a
 * top-level `config` (axios errors, and the generator's error result, which
 * merges the axios error fields) and `response.config` (the raw response
 * nested in both shapes, usually the same instance — redacted once, reused).
 * Header entries are own enumerable properties on both plain-object headers
 * and axios `AxiosHeaders` instances, so one path covers both shapes.
 */
export function sanitizeErrorCause(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  // Narrowed by the typeof/null guard above; reads only known fields.
  const record = error as Record<string, unknown>;
  const response =
    typeof record['response'] === 'object' && record['response'] !== null
      ? (record['response'] as Record<string, unknown>)
      : undefined;
  const configObjs = [record['config'], response?.['config']].filter(
    (candidate): candidate is Record<string, unknown> =>
      typeof candidate === 'object' && candidate !== null,
  );
  // Redact each distinct headers object once (configs usually share one).
  const replacements = new Map<object, Record<string, unknown>>();
  for (const config of configObjs) {
    const raw = config['headers'];
    if (typeof raw !== 'object' || raw === null || replacements.has(raw)) continue;
    const copy = { ...(raw as Record<string, unknown>) };
    let touched = false;
    for (const name of Object.keys(copy)) {
      if (SENSITIVE_HEADERS.has(name.toLowerCase())) {
        copy[name] = REDACTED_CREDENTIAL;
        touched = true;
      }
    }
    if (touched) replacements.set(raw, copy);
  }
  if (replacements.size === 0) return error;
  // Rebuild prototype-preserving clones along the edited paths only.
  const root = shallowClone(record);
  let responseClone: Record<string, unknown> | undefined;
  for (const config of new Set(configObjs)) {
    const headers = replacements.get(config['headers'] as object);
    if (headers === undefined) continue;
    const newConfig = { ...config, headers };
    if (config === record['config']) root['config'] = newConfig;
    if (response !== undefined && config === response['config']) {
      if (responseClone === undefined) responseClone = shallowClone(response);
      responseClone['config'] = newConfig;
    }
  }
  if (responseClone !== undefined) root['response'] = responseClone;
  return root;
}

/** Prototype-preserving shallow clone (keeps `instanceof` and `stack`). */
function shallowClone(source: Record<string, unknown>): Record<string, unknown> {
  return Object.assign(Object.create(Object.getPrototypeOf(source)), source);
}

export interface JiraApiErrorDetails {
  status?: number | undefined;
  message: string;
  /** Raw server error payload (`error` field of the generated result). */
  errorBody?: unknown;
  /** Delay requested by the server via `Retry-After`, in milliseconds. */
  retryAfterMs?: number | undefined;
  cause?: unknown;
}

export class JiraApiError extends Error {
  readonly status?: number | undefined;
  readonly errorBody?: unknown;
  readonly retryAfterMs?: number | undefined;

  constructor(details: JiraApiErrorDetails) {
    super(details.message);
    this.name = 'JiraApiError';
    this.status = details.status;
    this.errorBody = details.errorBody;
    this.retryAfterMs = details.retryAfterMs;
    if (details.cause !== undefined) this.cause = details.cause;
  }
}

interface AxiosLike {
  response?: { status?: number; data?: unknown; headers?: Record<string, unknown> } | undefined;
  request?: unknown;
  message?: unknown;
}

function isAxiosLike(value: unknown): value is AxiosLike {
  return typeof value === 'object' && value !== null && ('response' in value || 'request' in value);
}

/** Extract `Retry-After` (seconds or HTTP date) as milliseconds, if present. */
export function parseRetryAfter(headers: Record<string, unknown> | undefined): number | undefined {
  if (headers === undefined) return undefined;
  const get = headers as Record<string, unknown> & { get?: (name: string) => unknown };
  // Real axios responses carry an AxiosHeaders instance (case-insensitive
  // `.get`); test transports and plain objects carry a record. Support both.
  const fromGetter =
    typeof get.get === 'function' ? safeGet(get.get.bind(get), 'retry-after') : undefined;
  const raw =
    fromGetter ?? get['retry-after'] ?? get['Retry-After'] ?? get['RETRY-AFTER'];
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  if (typeof raw === 'number') return raw * 1000;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function safeGet(get: (name: string) => unknown, name: string): unknown {
  try {
    return get(name);
  } catch {
    return undefined;
  }
}

function messageFor(status: number | undefined, errorBody: unknown): string {
  if (typeof errorBody === 'object' && errorBody !== null) {
    // Narrowed by the typeof/null guard above; reads only known string fields.
    const record = errorBody as Record<string, unknown>;
    const messages = record['errorMessages'];
    if (Array.isArray(messages) && messages.length > 0) {
      return `Jira request failed${status === undefined ? '' : ` with status ${status}`}: ${messages.join('; ')}`;
    }
    const message = record['message'];
    if (typeof message === 'string' && message !== '') return message;
  }
  if (typeof errorBody === 'string' && errorBody !== '') return errorBody;
  return status === undefined ? 'Jira request failed: network error.' : `Jira request failed with status ${status}.`;
}

/** Normalize a thrown axios/network error into `JiraApiError`. */
export function toJiraApiError(error: unknown): JiraApiError {
  if (error instanceof JiraApiError) return error;
  if (isAxiosLike(error)) {
    const status = error.response?.status;
    const headers = error.response?.headers;
    if (status === undefined) {
      const message = typeof error.message === 'string' ? error.message : 'network error';
      return new JiraApiError({ message: `Jira request failed: ${message}.`, cause: sanitizeErrorCause(error) });
    }
    const body: unknown = error.response?.data;
    return new JiraApiError({
      status,
      message: messageFor(status, body),
      errorBody: body,
      retryAfterMs: parseRetryAfter(headers),
      cause: sanitizeErrorCause(error),
    });
  }
  if (error instanceof Error) {
    return new JiraApiError({ message: error.message, cause: sanitizeErrorCause(error) });
  }
  return new JiraApiError({ message: 'Jira request failed with an unknown error.', cause: error });
}

/** Result shape returned by generated operations when `throwOnError` is false. */
export interface JiraResult<TData, TError = unknown> {
  data?: TData | undefined;
  error?: TError | undefined;
  response?: { status: number } | undefined;
}

/**
 * Bridge for the default (non-throwing) result shape: returns `data` on
 * success, throws `JiraApiError` carrying `status` + server payload on
 * failure. Composes with `withRetry`: `withRetry(() => getIssue(…).then(throwIfJiraError))`.
 */
export function throwIfJiraError<TData, TError>(result: JiraResult<TData, TError>): TData {
  if (result.error !== undefined) {
    const response = result.response as
      | { status?: number; data?: unknown; headers?: Record<string, unknown> }
      | undefined;
    const status = response?.status;
    const body = result.error;
    throw new JiraApiError({
      status,
      message: messageFor(status, body),
      errorBody: body,
      retryAfterMs: parseRetryAfter(response?.headers),
      // The generator's error result merges the axios error fields (including
      // the live request config), so it needs the same redaction as throws.
      cause: sanitizeErrorCause(result),
    });
  }
  // Safe: the generated union guarantees `data` is present when `error` is absent.
  return result.data as TData;
}

export function isRetryableStatus(status: number | undefined): boolean {
  return status !== undefined && RETRYABLE_STATUS_CODES.includes(status);
}

/** Retryable = 429/502/503/504 or a network failure (no response status). */
export function isRetryableError(error: unknown): boolean {
  const normalized = error instanceof JiraApiError ? error : toJiraApiError(error);
  if (normalized.status === undefined) return true;
  return isRetryableStatus(normalized.status);
}

export interface RetryOptions {
  maxAttempts?: number | undefined;
  /** Base delay before doubling per attempt (plus the attempt index). */
  baseDelayMs?: number | undefined;
  /** Injectable clock; defaults to `setTimeout`. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run a throwing async function with retries for retryable failures only.
 * Client errors (400/401/403/404/…) are rethrown immediately without delay.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      const normalized = toJiraApiError(error);
      if (attempt >= maxAttempts || !isRetryableError(normalized)) throw normalized;
      const backoffMs = baseDelayMs * 2 ** (attempt - 1);
      const delayMs =
        normalized.status === 429 && normalized.retryAfterMs !== undefined
          ? normalized.retryAfterMs
          : backoffMs;
      await sleep(delayMs);
    }
  }
}
