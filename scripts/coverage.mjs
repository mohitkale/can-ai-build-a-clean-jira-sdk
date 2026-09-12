// Repeatable coverage check: compares OpenAPI operationIds against the
// operations actually exported by the generated SDK.
//
// The generator sanitizes some operationIds into valid JS identifiers
// (e.g. `getAvatarImageByID` → `getAvatarImageById`,
// `AddonPropertiesResource.getAddonProperties_get` →
// `addonPropertiesResourceGetAddonPropertiesGet`). Such renames are verified
// by canonical comparison (lowercase, alphanumeric only) AND by proving the
// mapping is collision-free in both directions.
//
// Usage: node scripts/coverage.mjs [--json]
// Exit code is 0 when every spec operation is exported, 1 otherwise.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = join(rootDir, 'openapi', 'jira-cloud-v3.json');
const generatedDir = join(rootDir, 'src', 'generated');

/** Canonical form: what the generator's identifier sanitization preserves. */
const canonical = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function specOperationIds(spec) {
  const ids = [];
  const methods = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
  for (const item of Object.values(spec.paths ?? {})) {
    for (const method of methods) {
      const operationId = item?.[method]?.operationId;
      if (typeof operationId === 'string') ids.push(operationId);
    }
  }
  return ids.sort();
}

// The generated SDK exposes one exported function per operation in
// src/generated/sdk.gen.ts. Parse export names without importing TS.
function exportedOperations() {
  const files = readdirSync(generatedDir);
  const sdkFile = files.find((f) => /^sdk\.gen\.(ts|js)$/.test(f));
  if (sdkFile === undefined) {
    throw new Error(`No sdk.gen file found in ${generatedDir}. Run \`npm run generate\` first.`);
  }
  const source = readFileSync(join(generatedDir, sdkFile), 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function duplicates(names) {
  const seen = new Map();
  const dupes = [];
  for (const name of names) {
    const key = canonical(name);
    if (seen.has(key)) dupes.push([seen.get(key), name]);
    else seen.set(key, name);
  }
  return dupes;
}

function main() {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const expected = specOperationIds(spec);
  const exported = exportedOperations();
  const exportedSet = new Set(exported);
  const exportedCanonical = new Map(exported.map((name) => [canonical(name), name]));

  const exact = expected.filter((id) => exportedSet.has(id));
  const renamed = [];
  const missing = [];
  for (const id of expected) {
    if (exportedSet.has(id)) continue;
    const target = exportedCanonical.get(canonical(id));
    if (target === undefined) missing.push(id);
    else renamed.push({ operationId: id, exportedAs: target });
  }

  const specCollisions = duplicates(expected);
  const exportCollisions = duplicates(exported);
  const ok = missing.length === 0 && specCollisions.length === 0 && exportCollisions.length === 0;

  const report = {
    totalOpenApiOperations: expected.length,
    totalExportedOperations: exported.length,
    exactNameMatches: exact.length,
    renamedByGenerator: renamed,
    missingOperations: missing,
    specCanonicalCollisions: specCollisions,
    exportCanonicalCollisions: exportCollisions,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`OpenAPI operations:   ${report.totalOpenApiOperations}`);
    console.log(`Exported operations:  ${report.totalExportedOperations}`);
    console.log(`Exact name matches:   ${report.exactNameMatches}`);
    console.log(`Generator renames:    ${renamed.length}`);
    for (const r of renamed) console.log(`  ~ ${r.operationId} -> ${r.exportedAs}`);
    if (missing.length > 0) {
      console.log(`Missing (${missing.length}):`);
      for (const id of missing) console.log(`  - ${id}`);
    } else {
      console.log('Missing: none. Complete API coverage verified.');
    }
    if (specCollisions.length > 0) console.log(`SPEC COLLISIONS: ${JSON.stringify(specCollisions)}`);
    if (exportCollisions.length > 0) {
      console.log(`EXPORT COLLISIONS: ${JSON.stringify(exportCollisions)}`);
    }
  }
  process.exit(ok ? 0 : 1);
}

main();
