// Generic pagination iterators. Jira mixes offset pages
// (`values` + `startAt`/`maxResults`/`total`/`isLast`) and token pages
// (`values` + `nextPageToken`, e.g. enhanced search). These helpers iterate
// either shape over a caller-supplied fetch callback, preserving generated
// types end-to-end via generics. They contain zero endpoint-specific logic.
//
// Falsy-zero rule: page boundaries use explicit `=== undefined` checks, never
// truthiness, so `startAt: 0` and `total: 0` behave correctly.

export interface OffsetPage<T> {
  values?: readonly T[] | undefined;
  startAt?: number | undefined;
  maxResults?: number | undefined;
  total?: number | undefined;
  isLast?: boolean | undefined;
}

export interface TokenPage<T> {
  values?: readonly T[] | undefined;
  // Jira documents the last page token as `null` (not absent).
  nextPageToken?: string | null | undefined;
}

export interface PaginateOptions {
  startAt?: number | undefined;
  maxResults?: number | undefined;
}

/** Iterate every item across offset-paginated pages. */
export async function* paginateOffset<T>(
  fetchPage: (args: { startAt: number; maxResults: number }) => Promise<OffsetPage<T> | undefined>,
  options: PaginateOptions = {},
): AsyncGenerator<T, void, void> {
  let startAt = options.startAt ?? 0;
  const maxResults = options.maxResults ?? 50;

  for (;;) {
    const page = await fetchPage({ startAt, maxResults });
    const values = page?.values ?? [];
    yield* values;

    if (values.length === 0) return;
    const nextStartAt = startAt + values.length;

    // Prefer the server's explicit signal; fall back to total arithmetic.
    if (page?.isLast !== undefined) {
      if (page.isLast === true) return;
    } else if (page?.total !== undefined) {
      if (nextStartAt >= page.total) return;
    } else if (values.length < maxResults) {
      return;
    }
    startAt = nextStartAt;
  }
}

/** Collect every item across offset-paginated pages into an array. */
export async function collectOffset<T>(
  fetchPage: (args: { startAt: number; maxResults: number }) => Promise<OffsetPage<T> | undefined>,
  options: PaginateOptions = {},
): Promise<T[]> {
  const items: T[] = [];
  for await (const item of paginateOffset(fetchPage, options)) items.push(item);
  return items;
}

/** Iterate every item across token-paginated (`nextPageToken`) pages. */
export async function* paginateToken<T>(
  fetchPage: (token: string | undefined) => Promise<TokenPage<T> | undefined>,
): AsyncGenerator<T, void, void> {
  let token: string | undefined;
  for (;;) {
    const page = await fetchPage(token);
    yield* (page?.values ?? []);
    // Stop on absent, empty, null, or non-string tokens. The enhanced-search
    // API documents the last-page token as `null`, which `!== undefined`
    // would otherwise mistake for "another page exists".
    const next: unknown = page?.nextPageToken;
    if (typeof next !== 'string' || next === '') return;
    token = next;
  }
}

/** Collect every item across token-paginated pages into an array. */
export async function collectToken<T>(
  fetchPage: (token: string | undefined) => Promise<TokenPage<T> | undefined>,
): Promise<T[]> {
  const items: T[] = [];
  for await (const item of paginateToken(fetchPage)) items.push(item);
  return items;
}
