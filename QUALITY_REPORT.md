# QUALITY_REPORT.md — Audit + Adversarial Review

Date (UTC): 2026-09-12. Spec pin: `openapi/jira-cloud-v3.json`
(421 paths, 617 operations, upstream `info.version`
1001.0.0-SNAPSHOT-3d120dbfd2d826e450656947143e5b8779387242,
SHA-256 `44a651e6…ba8`, see `openapi/SOURCE.md`).

## 1. Size audit

| Area | LOC |
|---|---|
| Generated (`src/generated/`, read-only) | 61,804 |
| Handwritten production (`src/*.ts`) | 433 |
| — `src/errors.ts` (largest handwritten file) | 197 |
| — `src/client.ts` | 117 |
| — `src/pagination.ts` | 91 |
| — `src/index.ts` (barrel, no logic) | 28 |
| Tests (`tests/unit` + `tests/integration` + helper) | 836 |
| Examples (`examples/`, type-checked) | 74 |
| Scripts (`scripts/`, deterministic tooling) | 215 |
| **Generated-to-handwritten production ratio** | **≈ 143 : 1** |

No handwritten file approaches 300 lines. Handwritten endpoint-specific
functions: **0** (pagination/retry helpers are fully generic).

## 2. Safety audit

- Uses of `any`: **0** (verified by `grep` + `@typescript-eslint/no-explicit-any`).
- Unsafe casts (`as`): **2**, both in `src/errors.ts`, both with documented
  reasons — narrowing `unknown` error payloads after a `typeof`/`null` guard,
  and reading `data` after the generated `{ data, error }` union proves `error`
  is absent. (One `as` re-export alias in `client.ts` is a type rename, not a cast.)
- Duplicate handwritten logic: none — auth resolution, pagination stepping,
  and retry classification each exist exactly once.
- `no-non-null-assertion` enforced in all linted sources.

## 3. Coverage audit (`npm run coverage`)

- Total OpenAPI operations: **617**
- Total generated/exported operations: **617**
- Missing operations: **none**
- 601 exact name matches; 16 generator renames (e.g.
  `getAvatarImageByID` → `getAvatarImageById`,
  `AddonPropertiesResource.getAddonProperties_get` →
  `addonPropertiesResourceGetAddonPropertiesGet`), each verified by canonical
  comparison **and** proven collision-free in both directions.

## 4. Test audit

- Unit tests: **37** (`tests/unit/`: client 8, pagination 9, errors 20).
- Integration tests: **26** (`tests/integration/`: auth wiring 7,
  serialization 4, pagination + errors 15). All run the real generated client
  against an in-repo axios transport (`tests/helpers/test-transport.ts`) that
  records the final request and replays canned responses — the generated code
  itself is never stubbed.
- Documentation examples type-checked: **3/3** (`get-issue`,
  `paginate-comments`, `create-issue`); every README operation name, config
  property, and request shape verified against generated types.
- Gates: `tsc --noEmit` clean (src + tests), examples project clean,
  `eslint` clean, `vitest` **63/63**, `tsup` build clean (ESM + CJS + `.d.ts` +
  `.d.cts`), `npm pack --dry-run` sane (13 files), CJS + ESM bundles
  smoke-tested in Node.

## 5. Adversarial review — "where could this look right but fail for a real user?"

1. **Auth clobbering.** Every operation declares both `basic` and `bearer`
   schemes; a single static token would be applied to both and one header
   would overwrite the other. Fixed with a per-scheme auth callback returning
   `undefined` for the unused scheme. Proven by header assertions for Basic,
   Bearer, rotation, and unauthenticated requests.
2. **Mock library silently not intercepting.** `axios-mock-adapter@2` installed
   its adapter yet requests bypassed it under axios 1.20 (empty history, live
   responses). Deleted the dependency; the in-repo transport replaces only the
   axios adapter, so URL/auth/serialization still execute. Bonus find: axios
   1.20 custom adapters resolve non-2xx instead of rejecting, so the transport
   rejects them with faithful `AxiosError`s.
3. **Non-`values` page shapes.** `PageOfComments` carries `comments`, not
   `values` — the first integration test unknowingly asserted a shape real
   Jira never returns. Reworked: real `values` coverage via `searchProjects`,
   plus a documented call-site adaptation for `comments` (mirrored in
   `examples/paginate-comments.ts` and README).
4. **Null `nextPageToken` infinite loop.** Enhanced search documents the last
   page token as `null`. The first paginator treated only `undefined`/`''` as
   terminal — a real user would loop forever on the last page. Fixed
   (`typeof next !== 'string'` terminates) and proven at the boundary with a
   `null`-terminated `searchAndReconsileIssuesUsingJql` walk.
5. **Falsy-zero pagination.** `startAt: 0` / `total: 0` must not read as
   missing. All boundary checks use explicit `=== undefined`; covered by unit
   (`total: 0` stops after one call) and boundary (first request carries
   `startAt=0`) tests.
6. **`Retry-After` on real responses.** Real axios surfaces `AxiosHeaders`
   (`.get`), not a plain record. `parseRetryAfter` supports both; a 429 +
   `retry-after: 4` boundary test proves the delay (4000 ms) reaches the sleep
   function.
7. **Over-strict tsconfig vs generated code.** `exactOptionalPropertyTypes`
   and a missing `DOM.Iterable` lib broke compilation of untouched generated
   files. Tuned the config (documented here); handwritten code is unaffected.

## 6. Acceptance verdicts

| Area | Status | Evidence |
|---|---|---|
| Regeneration from pinned spec (`npm run generate`) | VERIFIED | Clean-clone path: local pin + config; regenerated repeatedly during build |
| API coverage 617/617, 0 missing | VERIFIED | `npm run coverage` exit 0, collision-free |
| Clean TypeScript build (`typecheck` + examples) | VERIFIED | Both projects emit-free clean |
| Lint | VERIFIED | `eslint` clean, `any`/non-null-assertion banned |
| Unit tests | VERIFIED | 37/37 pass |
| Integration tests (auth, URL, serialization, pagination, errors, retry) | VERIFIED | 26/26 pass at the transport boundary |
| Documentation examples compile + use real APIs | VERIFIED | 3/3 type-checked; README symbols grepped against generated exports |
| npm pack (exports, ESM+CJS+d.ts, contents, bundle smoke test) | VERIFIED | Dry-run + Node CJS/ESM smoke test pass |
| Repository/homepage/issues URLs in package metadata | PARTIALLY VERIFIED | Fields present and well-formed, but no git remote exists to confirm the owner/name — update before publishing |
| Live Jira calls (real tenant, real network) | NOT VERIFIED | No credentials/network in this environment; transport-boundary tests are the deepest proof available here |

The library is **not** labeled "production-ready": live-tenant verification and
a confirmed repository URL remain open, stated above rather than claimed.
