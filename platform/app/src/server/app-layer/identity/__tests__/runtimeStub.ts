/**
 * A stand-in for the identity runtime, for suites that only need it to load.
 *
 * `betterAuth()` builds its adapter at module load, so a suite whose import
 * graph reaches the runtime has to mock it rather than import it. Listing the
 * exports by hand does not survive: the runtime gains one, a `vi.mock` factory
 * somewhere else is now missing it, and the suite fails on a name it never
 * uses. So the names are read out of the source rather than written down, with
 * no import, which is what keeps the two from drifting apart.
 *
 * Anything a suite actually calls it passes as an override.
 */

import { readFileSync } from "node:fs";

const DECLARED =
  /^export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z0-9_$]+)/gm;
/** `export { a, b as c } from "..."`, which the runtime also uses. */
const RE_EXPORTED = /^export\s*\{([^}]*)\}\s*from\s*["']/gm;

function exportedNames(): string[] {
  const source = readFileSync(
    new URL("../runtime.ts", import.meta.url),
    "utf8",
  );
  const names: string[] = [];
  for (const match of source.matchAll(DECLARED)) {
    if (match[1]) names.push(match[1]);
  }
  for (const match of source.matchAll(RE_EXPORTED)) {
    for (const part of (match[1] ?? "").split(",")) {
      // `a as b` exports the name after `as`, and a `type` entry is erased.
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && !name.startsWith("type ")) names.push(name);
    }
  }
  if (names.length === 0) {
    throw new Error("read the identity runtime and found no exports in it");
  }
  return names;
}

/**
 * Every export of the runtime, as a function answering an empty object, with
 * the caller's overrides on top.
 */
export function identityRuntimeStub(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const stub: Record<string, unknown> = {};
  for (const name of exportedNames()) {
    stub[name] = () => ({});
  }
  return { ...stub, ...overrides };
}
