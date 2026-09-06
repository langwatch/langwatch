/**
 * @vitest-environment node
 * Which storage engine and which account ceremonies this process composes.
 * @regression
 */
import type { IdentityEventingPort } from "@langwatch/identity-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import {
  ApiBetterAuthIdentityBranch,
  ApiIdentityBetterAuthCeremonies,
  ApiIdentityBetterAuthStorage,
  ApiPrismaBetterAuthStorage,
} from "../api-better-auth.composition.ts";

/** Nothing is queried: composition reaches no row, which is the point of the test. */
function database(): PrismaClient {
  return new Proxy({} as PrismaClient, { get: () => ({}) });
}

function eventing(): IdentityEventingPort {
  return { tryPipelineCommand: vi.fn(async () => null) } as unknown as IdentityEventingPort;
}

describe("ApiBetterAuthIdentityBranch", () => {
  /** @scenario "The API process composes the identity branch when it has an event stack" */
  describe("given a process that registered its identity pipeline", () => {
    it("composes the identity adapter rather than the stock engine", () => {
      const branch = ApiBetterAuthIdentityBranch.compose({
        database: database(),
        eventing: eventing(),
      });

      expect(branch.storage()).toBeInstanceOf(ApiIdentityBetterAuthStorage);
      expect(branch.storage()).not.toBeInstanceOf(ApiPrismaBetterAuthStorage);
      expect(typeof branch.storage().adapter()).toBe("function");
    });

    it("binds the bridge ceremonies rather than the no-ops", async () => {
      const branch = ApiBetterAuthIdentityBranch.compose({
        database: database(),
        eventing: eventing(),
      });
      const ceremonies = branch.identity();

      expect(ceremonies).toBeInstanceOf(ApiIdentityBetterAuthCeremonies);
      // The gate reads the migration state through the proxy above and finds no
      // record, so an unlatched user's create ceremony states nothing — which is
      // the closed gate, not an absent ceremony.
      await expect(
        ceremonies.tryBeforeAccountCreate({
          id: "acc-1",
          userId: "user-1",
          providerId: "credential",
          accountId: "user-1",
        } as never),
      ).resolves.toBeUndefined();
    });
  });
});
