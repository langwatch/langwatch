/** Spec: packages/process/specs/api-surface.feature. */

import type { Authorize } from "@langwatch/api/access";
import { SessionReader, type TrpcSessionVersions } from "@langwatch/api/hosting";
import { composeTrpcRouters, defineTrpcRouter, TrpcHost } from "@langwatch/api/trpc";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { testAuthorizeDefaults } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { inertApiDoor } from "../../__tests__/support/api-door.ts";
import { composeApiApplication } from "../api-surface.ts";

interface SweepApi {
  sweep(): { swept: number };
}

const SweepApi = moduleApi<SweepApi>()("annotation");

const sweepTrpc = defineTrpcContract("sweeper")
  .mutation("sweep")
  .withInput(z.void())
  .withOutput(z.object({ swept: z.number() }))
  .build();

const router = defineTrpcRouter(SweepApi, sweepTrpc)
  .procedure("sweep")
  .noPermission({ reason: "a test namespace; no permission applies" })
  .handle(({ app }) => app.sweep())
  .build();

function composeSweeper() {
  const authz: Authorize & TrpcSessionVersions = {
    ...testAuthorizeDefaults,
    ...inertApiDoor().authz,
    getSessionVersion: async () => 1,
    checkScopeLineage: async () => ({ kind: "consistent" }),
  };
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "user_ada" }) }),
    authz,
    sessionVersions: authz,
  });
  const application: SweepApi = { sweep: () => ({ swept: 2 }) };
  trpc.mount(composeTrpcRouters("sweeper", [router]), () => application);
  return composeApiApplication({ trpc });
}

describe("given a tRPC mutation declared with no input", () => {
  describe("when the browser client posts it as JSON with an empty body", () => {
    /** @scenario "A mutation that takes no input runs when the browser posts no body" */
    it("runs the mutation and answers 200", async () => {
      const answer = await composeSweeper().request("/api/trpc/sweeper.sweep", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "0" },
      });

      expect(answer.status).toBe(200);
      await expect(answer.json()).resolves.toMatchObject({ result: { data: { swept: 2 } } });
    });
  });
});
