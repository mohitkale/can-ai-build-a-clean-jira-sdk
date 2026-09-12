import { describe, expect, it } from 'vitest';

import {
  collectOffset,
  collectToken,
  paginateOffset,
  paginateToken,
} from '../../src/pagination.js';
import type { OffsetPage, TokenPage } from '../../src/pagination.js';

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

describe('paginateOffset', () => {
  it('walks multiple pages starting at startAt = 0', async () => {
    const seen: { startAt: number; maxResults: number }[] = [];
    const fetchPage = async (args: { startAt: number; maxResults: number }): Promise<OffsetPage<number>> => {
      seen.push(args);
      const startAt = args.startAt;
      if (startAt === 0) return { values: [1, 2], startAt: 0, maxResults: 2, total: 5, isLast: false };
      if (startAt === 2) return { values: [3, 4], startAt: 2, maxResults: 2, total: 5, isLast: false };
      return { values: [5], startAt: 4, maxResults: 2, total: 5, isLast: true };
    };
    expect(await drain(paginateOffset(fetchPage, { maxResults: 2 }))).toEqual([1, 2, 3, 4, 5]);
    expect(seen[0]).toEqual({ startAt: 0, maxResults: 2 });
  });

  it('stops on the final page and on zero results', async () => {
    const single = await collectOffset<number>(async () => ({
      values: [1],
      total: 1,
      isLast: true,
    }));
    expect(single).toEqual([1]);

    const empty = await collectOffset<number>(async () => ({ values: [], total: 0, isLast: true }));
    expect(empty).toEqual([]);
  });

  it('does not treat numeric zero as missing (total: 0 stops after page one)', async () => {
    let calls = 0;
    const items = await collectOffset<number>(async () => {
      calls += 1;
      return { values: [], startAt: 0, maxResults: 50, total: 0 };
    });
    expect(items).toEqual([]);
    expect(calls).toBe(1);
  });

  it('falls back to total arithmetic when isLast is absent', async () => {
    const items = await collectOffset<number>(async ({ startAt }) => ({
      values: startAt === 0 ? [1, 2] : [3],
      startAt,
      total: 3,
    }));
    expect(items).toEqual([1, 2, 3]);
  });

  it('stops on a short final page when totals are missing entirely', async () => {
    const items = await collectOffset<number>(
      async ({ startAt }) => ({ values: startAt === 0 ? [1, 2] : [] }),
      { maxResults: 2 },
    );
    expect(items).toEqual([1, 2]);
  });
});

describe('paginateToken', () => {
  it('follows nextPageToken across pages and stops when it is absent', async () => {
    const tokens: (string | undefined)[] = [];
    const fetchPage = async (token: string | undefined): Promise<TokenPage<string>> => {
      tokens.push(token);
      if (token === undefined) return { values: ['a'], nextPageToken: 't1' };
      if (token === 't1') return { values: ['b'], nextPageToken: 't2' };
      return { values: ['c'] };
    };
    expect(await collectToken(fetchPage)).toEqual(['a', 'b', 'c']);
    expect(tokens).toEqual([undefined, 't1', 't2']);
  });

  it('handles empty result sets', async () => {
    expect(await collectToken<string>(async () => ({ values: [] }))).toEqual([]);
  });

  it('stops on a documented null last-page token instead of looping', async () => {
    let calls = 0;
    const items = await collectToken<string>(async () => {
      calls += 1;
      return { values: ['a'], nextPageToken: null };
    });
    expect(items).toEqual(['a']);
    expect(calls).toBe(1);
  });

  it('exposes an async-generator interface', async () => {
    const gen = paginateToken<string>(async () => ({ values: ['x'] }));
    expect(await drain(gen)).toEqual(['x']);
  });
});
