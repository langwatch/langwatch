/// <reference types="node" />

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_PERMISSIONS } from "@langwatch/authorization";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { encodePermissionBitset } from "../bitset.ts";
import {
  type AttachGrantCommandData,
  type AuthzDecision,
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  type GrantAttachedPayload,
  attachGrantCommandDataSchema,
  authzDecisionSchema,
  authzPrincipalRefSchema,
  authzScopeRefSchema,
  grantAttachedPayloadSchema,
} from "../index.ts";

const sourceDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

function importSpecifiers(): string[] {
  return readdirSync(sourceDirectory)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) =>
      [
        ...readFileSync(join(sourceDirectory, file), "utf8").matchAll(
          /(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
        ),
      ].map((match) => match[1] as string),
    );
}

const FORBIDDEN_IMPORT =
  /^node:|^(?:fs|path|crypto|os|http|https|net)(?:\/|$)|prisma|redis|eventing|hono|@trpc\/server|^@\/|\/apps\/|langwatch\/src\/server/;

describe("given a browser or another feature importing the AuthZ contract", () => {
  /** @scenario The contract is portable and uses Zod 4 */
  it("builds principals, scopes, decisions, commands and event payloads from Zod 4 schemas", () => {
    expect(typeof z.toJSONSchema).toBe("function");
    for (const schema of [
      authzPrincipalRefSchema,
      authzScopeRefSchema,
      authzDecisionSchema,
      attachGrantCommandDataSchema,
      grantAttachedPayloadSchema,
    ]) {
      expect(schema).toHaveProperty("_zod");
    }

    expectTypeOf<AuthzPrincipalRef>().toEqualTypeOf<z.infer<typeof authzPrincipalRefSchema>>();
    expectTypeOf<AuthzScopeRef>().toEqualTypeOf<z.infer<typeof authzScopeRefSchema>>();
    expectTypeOf<AuthzDecision>().toEqualTypeOf<z.infer<typeof authzDecisionSchema>>();
    expectTypeOf<AttachGrantCommandData>().toEqualTypeOf<
      z.infer<typeof attachGrantCommandDataSchema>
    >();
    expectTypeOf<GrantAttachedPayload>().toEqualTypeOf<
      z.infer<typeof grantAttachedPayloadSchema>
    >();
  });

  /** @scenario The contract is portable and uses Zod 4 */
  it("retains the permission registry's exact append-only order", () => {
    expect(ALL_PERMISSIONS.slice(0, 12)).toEqual([
      "organization:view",
      "organization:manage",
      "organization:delete",
      "project:view",
      "project:create",
      "project:update",
      "project:delete",
      "project:manage",
      "team:view",
      "team:manage",
      "analytics:view",
      "analytics:create",
    ]);
    expect(encodePermissionBitset(["organization:view", "project:view"])[0]).toBe(0b0000_1001);
  });

  /** @scenario The contract is portable and uses Zod 4 */
  it("imports no Node, Prisma, Redis, Eventing, Hono, tRPC server code or application source", () => {
    const specifiers = importSpecifiers();

    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => FORBIDDEN_IMPORT.test(specifier))).toEqual([]);
  });
});
