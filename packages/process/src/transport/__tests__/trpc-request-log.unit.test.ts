/** Spec: specs/observability/request-log-cause-and-level.feature */

import type { Authorize } from "@langwatch/api/access";
import { SessionReader, type TrpcSessionVersions } from "@langwatch/api/hosting";
import { composeTrpcRouters, defineTrpcRouter, TrpcHost } from "@langwatch/api/trpc";
import { HandledError } from "@langwatch/handled-error";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import type * as Observability from "@langwatch/observability";
import { testAuthorizeDefaults } from "@langwatch/test-harness/trpc-members";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { inertApiDoor } from "../../__tests__/support/api-door.ts";
import { composeApiApplication } from "../api-surface.ts";

class ClickhouseOverloadedError extends HandledError {
  constructor() {
    super("clickhouse_overloaded", "busy", { httpStatus: 503, fault: "platform" });
  }
}

const records = vi.hoisted(
  () => [] as { logger: string; message: string; fields: Record<string, unknown> }[],
);

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = actual.createLogger(name);
      if (name !== "langwatch:api:hono") return logger;
      const capture =
        () =>
        (fields: Record<string, unknown>, message: string): void => {
          records.push({ logger: name, message, fields });
        };
      return Object.assign(Object.create(logger), {
        info: capture(),
        warn: capture(),
        error: capture(),
      });
    },
  };
});

interface SweepApi {
  sweep(): { swept: number };
}

const SweepApi = moduleApi<SweepApi>()("annotation");

const sweepTrpc = defineTrpcContract("sweeper")
  .query("sweep")
  .withInput(z.void())
  .withOutput(z.object({ swept: z.number() }))
  .build();

const router = defineTrpcRouter(SweepApi, sweepTrpc)
  .procedure("sweep")
  .noPermission({ reason: "a test namespace; no permission applies" })
  .handle(({ app }) => app.sweep())
  .build();

function composeSweeper(sweep: () => { swept: number }) {
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
  trpc.mount(composeTrpcRouters("sweeper", [router]), () => ({ sweep }));
  return composeApiApplication({ trpc });
}

describe("the tRPC lane's access record", () => {
  beforeEach(() => {
    records.length = 0;
  });

  describe("when the dashboard calls a procedure that answers", () => {
    /** @scenario "A dashboard tRPC request writes the same access record as a REST request" */
    it("writes one record under langwatch:api:hono naming the trpc family", async () => {
      const answer = await composeSweeper(() => ({ swept: 2 })).request("/api/trpc/sweeper.sweep");

      expect(answer.status).toBe(200);
      expect(records).toEqual([
        expect.objectContaining({
          message: "request handled",
          fields: expect.objectContaining({
            family: "trpc",
            method: "GET",
            url: "/api/trpc/sweeper.sweep",
            statusCode: 200,
            duration: expect.any(Number),
          }),
        }),
      ]);
    });
  });

  describe("when a signed-in user's procedure call is answered", () => {
    /** @scenario "The request log names the user behind a session" */
    it("names the session's user on the access record", async () => {
      const answer = await composeSweeper(() => ({ swept: 1 })).request("/api/trpc/sweeper.sweep");

      expect(answer.status).toBe(200);
      expect(records[0]?.fields).toMatchObject({ "user.id": "user_ada" });
    });
  });

  describe("when the procedure fails with a handled platform error", () => {
    /** @scenario "A tRPC failure with a handled cause is logged by its fault" */
    it("carries the handled code and fault on the record", async () => {
      const app = composeSweeper(() => {
        throw new ClickhouseOverloadedError();
      });

      const answer = await app.request("/api/trpc/sweeper.sweep");

      expect(answer.status).toBeGreaterThanOrEqual(500);
      expect(records).toHaveLength(1);
      expect(records[0]?.message).not.toBe("request failed without a cause attached");
      expect(records[0]?.fields).toMatchObject({
        family: "trpc",
        handledErrorCode: "clickhouse_overloaded",
        handledErrorFault: "platform",
      });
    });
  });
});
