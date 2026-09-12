// Minimal in-repo HTTP-boundary mock: an axios `adapter` that records the
// final outgoing request (URL, method, headers, body) and replays canned
// responses. It sits *below* the generated client — URL building, auth
// headers, and serialization all execute for real — replacing only transport.

import { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  data: unknown;
}

export interface MockReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Simulate a transport failure (no HTTP response at all). */
  networkError?: boolean;
}

export type MockResponder = (request: RecordedRequest, callIndex: number) => MockReply;

export interface TestTransport {
  adapter: AxiosAdapter;
  requests: RecordedRequest[];
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (headers !== null && typeof headers === 'object' && 'toJSON' in headers) {
    const asJson = (headers as { toJSON: () => unknown }).toJSON();
    if (asJson !== null && typeof asJson === 'object') {
      return asJson as Record<string, string>;
    }
  }
  const out: Record<string, string> = {};
  if (headers !== null && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
  }
  return out;
}

export function createTestTransport(responder: MockResponder): TestTransport {
  const requests: RecordedRequest[] = [];
  const adapter: AxiosAdapter = (config) =>
    new Promise<AxiosResponse>((resolve, reject) => {
      const request: RecordedRequest = {
        url: config.url ?? '',
        method: (config.method ?? 'get').toLowerCase(),
        headers: normalizeHeaders(config.headers),
        data: config.data,
      };
      const reply = responder(request, requests.length);
      requests.push(request);
      if (reply.networkError === true) {
        reject(new AxiosError('Network Error', undefined, config, {}, undefined));
        return;
      }
      const response: AxiosResponse = {
        data: reply.body,
        status: reply.status,
        statusText: reply.status === 200 || reply.status === 201 ? 'OK' : 'Error',
        headers: reply.headers ?? {},
        config,
      };
      // Real transports surface non-2xx as rejected axios errors; mirror that.
      if (reply.status >= 200 && reply.status < 300) {
        resolve(response);
        return;
      }
      reject(
        new AxiosError(
          `Request failed with status code ${reply.status}`,
          reply.status >= 400 && reply.status < 500 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE',
          config,
          {},
          response,
        ),
      );
    });
  return { adapter, requests };
}

/** Shorthand: every request gets the same status/body. */
export function staticTransport(status: number, body: unknown): TestTransport {
  return createTestTransport(() => ({ status, body }));
}
