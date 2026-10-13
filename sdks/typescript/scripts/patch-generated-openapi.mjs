// Post-generation patch for the openapi-typescript output.
//
// The spec's JsonValue component is recursive (arrays and records of
// itself). openapi-typescript emits the recursion as an indexed-access
// self-reference inside the `components` interface member, which
// TypeScript rejects (TS2502: referenced directly or indirectly in its
// own type annotation). Recursion through a standalone type alias is
// legal, so the member is rerouted through one. Runs as part of
// generate:openapi-types; the generated file stays fully reproducible.
import { readFileSync, writeFileSync } from "node:fs";

const target = new URL("../src/internal/generated/openapi/api-client.ts", import.meta.url);
let source = readFileSync(target, "utf8");

const member =
  /JsonValue: string \| number \| boolean \| null \| components\["schemas"\]\["JsonValue"\]\[\] \| \{\s*\[key: string\]: components\["schemas"\]\["JsonValue"\];\s*\};/;
if (!member.test(source)) {
  // Already patched or the shape changed; both are fine to leave alone,
  // the typecheck will say if anything is actually wrong.
  process.exit(0);
}
source = source.replace(member, "JsonValue: RecursiveJsonValue;");
source += `
/**
 * Recursive JSON value for components["schemas"]["JsonValue"]: hoisted to a
 * standalone alias because TypeScript rejects the self-referential
 * indexed-access form openapi-typescript emits for recursive components.
 */
export type RecursiveJsonValue =
    | string
    | number
    | boolean
    | null
    | RecursiveJsonValue[]
    | { [key: string]: RecursiveJsonValue };
`;
writeFileSync(target, source);
console.log("patched JsonValue recursion in api-client.ts");
