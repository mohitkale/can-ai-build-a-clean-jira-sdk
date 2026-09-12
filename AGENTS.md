# AGENTS.md — Permanent Engineering Contract

Every agent session must read and follow this file before modifying this repository.
It outranks ad-hoc instructions when they conflict with correctness, completeness,
or maintainability.

## 1. Generated code is cheap. Handwritten code is expensive.

Optimize for correctness, completeness, minimal handwritten code, strong typing,
maintainability, reproducibility, and real integration verification — never for
producing code quickly.

## 2. Never manually recreate what OpenAPI already provides.

Endpoint definitions, request types, response types, and schema information come
from `openapi/jira-cloud-v3.json` via `@hey-api/openapi-ts`. Do not hand-write
copies of them in `src/`, `tests/`, or `examples/`.

## 3. Prefer deterministic generation over LLM-written repetition.

Repetitive endpoint wrappers must be produced by `npm run generate`, not written
by hand. A handwritten file that enumerates endpoints is a defect.

## 4. Generated files are read-only.

Everything under `src/generated/` is produced by `npm run generate` and must
never be manually modified. To change generated output, change
`openapi-ts.config.ts` or the pinned spec, then regenerate.

## 5. Keep handwritten modules small, focused, and easy to review.

Handwritten production code lives only in `src/*.ts` (never in
`src/generated/`). Each module has one job: client configuration, pagination,
or error handling.

## 6. Respect the ~300-line limit.

If a handwritten file approaches roughly 300 lines, reconsider the architecture
before extending it. Split by responsibility or delete code — do not grow it.

## 7. No giant constructs.

Avoid giant classes, giant switch statements, large endpoint registries, and
repetitive request methods. Zero handwritten endpoint-specific functions is the
target; pagination and retry helpers must be generic.

## 8. No decorative abstractions.

Avoid abstractions that exist only to make the architecture appear
sophisticated. Every layer must be justified in `ARCHITECTURE.md`. If the
generator's native client abstraction already solves a problem cleanly, use it
instead of duplicating it.

## 9. Delete rather than hide.

Delete unnecessary code rather than hiding it behind abstractions. No empty
placeholder classes (no `Issues`, `Projects`, or `Users` shells), no unused
exports, no speculative helpers.

## 10. Avoid `any`.

Avoid `any`. Any unavoidable unsafe cast must carry a comment documenting why
it is safe. `npm run lint` and the quality audit count both.

## 11. Preserve generated types end-to-end.

Public APIs, helpers, tests, and examples must reuse generated TypeScript types
(`src/generated/types.gen.ts`, `sdk.gen.ts`). Do not redefine or widen them.

## 12. Configuration must reach the wire.

Authentication, base URL, headers, serialization, errors, and pagination must be
integrated with the actual HTTP client used by generated API calls
(`@hey-api/client-axios` over axios). Never store configuration in a wrapper
that does not affect generated requests. Prove it with integration tests that
mock the network boundary (not the generated client).

## 13. Unit tests alone prove nothing about the SDK.

Unit tests alone are not proof that the SDK works. Pure-logic tests are welcome
but insufficient.

## 14. Every critical path gets an integration test.

Base URL wiring, Basic auth, Bearer/OAuth auth, auth/base-URL switching,
parameter/body serialization through a real generated operation, pagination
boundaries, and error/retry behavior must have integration-level tests in
`tests/integration/` running against a mocked HTTP boundary.

## 15. Documentation examples are executable specifications.

Every TypeScript example in `README.md` and `examples/` must be type-checked
(`npm run typecheck:examples`). Every imported symbol, constructor/config
property, operation name, request parameter, and return-value usage must be
real. If an example does not compile or behave correctly, the project is not
complete. Never invent friendly aliases (e.g. `searchIssues`) unless the SDK
actually exports and tests them.

## 16. Never claim what is not verified.

Never claim a feature in `README.md`, package metadata, or completion summaries
unless it has been verified by the relevant gate in step 18.

## 17. "Production-ready" is earned, not asserted.

Never call the project "production-ready" based solely on compilation or mocked
unit tests. The term requires the full acceptance gate below to be green, with
any residual gaps labeled PARTIALLY VERIFIED or NOT VERIFIED.

## 18. Try to prove the implementation wrong before completing.

Before completion, actively attack the library: auth not reaching the wire,
base-URL drift, falsy-zero pagination bugs, error-swallowing, unverified export
claims, stale spec pins. Investigate every failure mode in `QUALITY_REPORT.md`.
The final summary must label each critical area VERIFIED, PARTIALLY VERIFIED,
or NOT VERIFIED.

## 19. Verification gates (run in order)

```sh
npm run generate        # regenerate SDK from the pinned OpenAPI source
npm run coverage        # OpenAPI operationIds vs exported operations
npm run typecheck       # clean TypeScript build check
npm run typecheck:examples  # documentation examples compile
npm run lint            # lint clean
npm test                # unit + integration tests
npm run build           # distributable build
npm pack --dry-run      # package contents sane
```

Do not stop because one suite is green. If something remains unverified, state
it explicitly rather than claiming success.
