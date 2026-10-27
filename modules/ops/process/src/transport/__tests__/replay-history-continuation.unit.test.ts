/**
 * @vitest-environment node
 * The paged replay history over the real runtime: the door asks `ops:view` at the platform, and the
 * whole-history procedure keeps answering the array it always did.
 */
import { bindTrpcMiddlewareContext, createTrpcRuntime } from "@langwatch/api/trpc";
import type { OpsOperator, ReplayHistoryEntry } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import {
  createOpsTestApp,
  OPS_STAFF_ADDRESS,
  platformOperatorAuthz,
} from "../../app/__tests__/ops.fixture.ts";
import type { OpsReplayRunner } from "../../app/ops.app.ts";
import { opsEventLogTrpcTransport } from "../ops-event-log.trpc.ts";
import { opsOperatorContext } from "../ops-operator.trpc.ts";
import { opsTrpcMembers, type OpsTrpcTestContext } from "./ops.trpc.harness.ts";

const VIEWER: OpsOperator = { id: "user_viewer", email: OPS_STAFF_ADDRESS };
const OUTSIDER: OpsOperator = { id: "user_sam", email: "sam@acme.com" };

const finished: ReplayHistoryEntry = {
  runId: "run_1",
  projectionNames: ["trace-summary"],
  since: "2026-01-01T00:00:00.000Z",
  tenantIds: [],
  description: "repair",
  startedAt: "2026-10-01T00:00:00.000Z",
  completedAt: "2026-10-01T00:01:00.000Z",
  state: "completed",
  userName: "operator@example.com",
  aggregatesProcessed: 1,
  eventsProcessed: 1,
  error: null,
};

function mountHistory({ replay }: { replay: OpsReplayRunner }) {
  const holders = { [VIEWER.id]: ["ops:view"] } as const;
  const { app } = createOpsTestApp({
    capability: { replay },
    authz: platformOperatorAuthz({ holders }),
  });
  const trpc = initTRPC.context<OpsTrpcTestContext>().create();
  const router = createTrpcRuntime<OpsTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: opsTrpcMembers({ holders }),
  }).mount(opsEventLogTrpcTransport, () => app, {
    middlewareContext: [
      bindTrpcMiddlewareContext(opsOperatorContext, (ctx: OpsTrpcTestContext) => ctx.operator),
    ],
  });

  return {
    viewer: router.createCaller({ actor: { id: VIEWER.id }, operator: VIEWER }),
    outsider: router.createCaller({ actor: { id: OUTSIDER.id }, operator: OUTSIDER }),
    anonymous: router.createCaller({ actor: null, operator: null }),
  };
}

describe("the paged replay history procedure", () => {
  describe("given a caller without the platform view permission", () => {
    /** @scenario "Reading the history by page is an operator view, like reading it whole" */
    it("refuses them and reads no history", async () => {
      const getHistoryPage = vi.fn(async () => ({ outcome: "cursor_expired" as const }));
      const { outsider, anonymous } = mountHistory({
        replay: createApiFixture<OpsReplayRunner>({ getHistoryPage }),
      });

      await expect(outsider.getReplayHistoryPage({})).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "permission_denied", meta: { permission: "ops:view" } },
      });
      await expect(anonymous.getReplayHistoryPage({})).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(getHistoryPage).not.toHaveBeenCalled();
    });
  });

  describe("given an operator who may view", () => {
    it("hands the parsed cursor and the default limit to the replay and returns its page", async () => {
      const asked: Parameters<OpsReplayRunner["getHistoryPage"]>[0][] = [];
      const { viewer } = mountHistory({
        replay: createApiFixture<OpsReplayRunner>({
          getHistoryPage: async (input) => {
            asked.push(input);

            return { outcome: "page", entries: [finished], hasMore: true, nextCursor: "run_1" };
          },
        }),
      });

      await expect(viewer.getReplayHistoryPage({ cursor: "run_2" })).resolves.toEqual({
        outcome: "page",
        entries: [finished],
        hasMore: true,
        nextCursor: "run_1",
      });
      expect(asked).toEqual([{ cursor: "run_2", limit: 20 }]);
    });

    it("refuses a limit past the retained history before the replay is asked", async () => {
      const getHistoryPage = vi.fn(async () => ({ outcome: "cursor_expired" as const }));
      const { viewer } = mountHistory({
        replay: createApiFixture<OpsReplayRunner>({ getHistoryPage }),
      });

      await expect(viewer.getReplayHistoryPage({ limit: 500 })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(getHistoryPage).not.toHaveBeenCalled();
    });

    it("keeps answering the whole history as an array on the old procedure", async () => {
      const { viewer } = mountHistory({
        replay: createApiFixture<OpsReplayRunner>({ getHistory: async () => [finished] }),
      });

      await expect(viewer.getReplayHistory()).resolves.toEqual([finished]);
    });
  });
});
