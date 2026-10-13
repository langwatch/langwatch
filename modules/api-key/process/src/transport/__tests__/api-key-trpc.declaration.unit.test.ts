/**
 * The `apiKey.*` tRPC wire, pinned: name, kind, and access declaration
 * per procedure. A rename here is a cache-key change in every browser.
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
 * No `apiKey:*` permission exists: a personal key belongs to its owner, and
 * the application proves membership and ownership itself.
 */
const OWN_KEYS = {
  kind: "no-permission",
  reason:
    "personal API keys are the caller's own; the application proves organization membership and ownership itself",
};

const KEY_ASSIGNMENT = {
  kind: "no-permission",
  reason:
    "any member assigning a key needs the organization's projects, teams and members; the application refuses a non-member before reading",
};

const MEMBER_ONLY = {
  organizationId: "the application refuses a caller who is not a member of this organization",
};

/** @scenario "The API-key transport moves without changing who may call it" */
it("binds every declared procedure once and preserves its access declaration", () => {
  const declarations = accessDeclaredBy(apiKeyTrpcTransport);

  expect(
    Object.entries(apiKeyTrpc.members).map(([name, member], index) => [
      name,
      member.kind,
      declarations[index],
    ]),
  ).toEqual([
    ["myBindings", "query", { ...OWN_KEYS, allow: MEMBER_ONLY }],
    ["nameById", "query", { ...OWN_KEYS, allow: MEMBER_ONLY }],
    ["list", "query", { ...OWN_KEYS, allow: MEMBER_ONLY }],
    ["create", "mutation", { ...OWN_KEYS, allow: MEMBER_ONLY }],
    ["update", "mutation", { ...OWN_KEYS, allow: MEMBER_ONLY }],
    ["revoke", "mutation", { ...OWN_KEYS, allow: MEMBER_ONLY }],
    ["orgProjects", "query", { ...KEY_ASSIGNMENT, allow: MEMBER_ONLY }],
    ["orgTeams", "query", { ...KEY_ASSIGNMENT, allow: MEMBER_ONLY }],
    ["orgMembers", "query", { ...KEY_ASSIGNMENT, allow: MEMBER_ONLY }],
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
        expect.stringMatching(/^(?:zod|@langwatch\/api\/contract|@langwatch\/module$|\.\/)/),
        relative,
      ]);
    }
  }
});
