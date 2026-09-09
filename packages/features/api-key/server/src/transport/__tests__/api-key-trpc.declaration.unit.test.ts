/**
 * The `apiKey.*` tRPC wire, pinned: every procedure name, its kind, and the
 * access declaration the server binds to it. A rename here is a cache-key
 * change in every browser that calls it.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apiKeyTrpc } from "@langwatch/api-key-contract";
import { expect, it } from "vitest";

import { apiKeyTrpcTransport } from "../api-key.trpc.ts";
import { accessDeclaredBy } from "./api-key-trpc.fixture.ts";

const featureRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Every `import`/`export … from` that is not erased at build time. */
function valueImports(relative: string): string[] {
  const path = join(featureRoot, relative);
  expect(existsSync(path), `${path} is a declaration this guard reads; it moved`).toBe(true);

  return [
    ...readFileSync(path, "utf8").matchAll(
      /^(?:import|export)\s+(?!type\s)[^;]*?from\s+"([^"]+)";/gm,
    ),
  ].map((match) => match[1]!);
}

/**
 * One shared reason: no `apiKey:*` permission exists, because a personal key
 * belongs to its owner and the application proves membership and ownership
 * itself. Every procedure states that opt-out with the organization id
 * explicitly allowed.
 */
const OWN_KEYS = {
  kind: "no-permission",
  reason:
    "personal API keys are the caller's own; the application proves organization membership and ownership itself",
};

it("binds every declared procedure once and preserves its access declaration", () => {
  const declarations = accessDeclaredBy(apiKeyTrpcTransport);

  expect(
    Object.entries(apiKeyTrpc.members).map(([name, member], index) => [
      name,
      member.kind,
      declarations[index],
    ]),
  ).toEqual([
    [
      "myBindings",
      "query",
      { ...OWN_KEYS, allow: { organizationId: "listing caller's own role bindings" } },
    ],
    [
      "nameById",
      "query",
      { ...OWN_KEYS, allow: { organizationId: "naming an API key the caller can already see" } },
    ],
    ["list", "query", { ...OWN_KEYS, allow: { organizationId: "listing API keys" } }],
    [
      "create",
      "mutation",
      { ...OWN_KEYS, allow: { organizationId: "creating API key for user's own org" } },
    ],
    ["update", "mutation", { ...OWN_KEYS, allow: { organizationId: "updating API key" } }],
    ["revoke", "mutation", { ...OWN_KEYS, allow: { organizationId: "revoking API key" } }],
    [
      "orgProjects",
      "query",
      { ...OWN_KEYS, allow: { organizationId: "listing org projects for permission picker" } },
    ],
    [
      "orgTeams",
      "query",
      { ...OWN_KEYS, allow: { organizationId: "listing org teams for scope picker" } },
    ],
    [
      "orgMembers",
      "query",
      { ...OWN_KEYS, allow: { organizationId: "listing org members for key assignment" } },
    ],
  ]);
});

it("declares an output for every procedure", () => {
  const withoutOutput = Object.entries(apiKeyTrpc.members)
    .filter(([, member]) => member.output === undefined)
    .map(([name]) => name);

  expect(withoutOutput).toEqual([]);
});

/** @scenario "A contract declares a procedure once, in a browser-safe module" */
it("keeps the contract modules browser-safe: no server framework in their value imports", () => {
  for (const relative of ["contract/src/api-key.trpc.ts", "contract/src/api-key-trpc.schemas.ts"]) {
    for (const specifier of valueImports(relative)) {
      expect([specifier, relative]).toEqual([
        expect.stringMatching(/^(?:zod|@langwatch\/api\/contract|\.\/)/),
        relative,
      ]);
    }
  }
});
