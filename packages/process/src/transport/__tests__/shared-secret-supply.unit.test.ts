/**
 * Spec: specs/server/typed-process-supply.feature,
 * "a credential the deployment supplies is named, not spelled".
 */
import { createServer } from "node:http";

import { RawHttpHost, WebSocketHost } from "@langwatch/api";
import { anyAuthenticated } from "@langwatch/api/access";
import { type NodeHandler, TransportSelection } from "@langwatch/api/hosting";
import { defineRestRouter } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import { createLogger } from "@langwatch/observability";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { peersWithDoor } from "../../__tests__/support/api-door.ts";
import { apiSurface, type ApiSurfaceComposition, bearerDoor } from "../api-surface.ts";

interface SweepApi {
  sweep(): Promise<{ swept: true }>;
}
const SweepApi = moduleApi<SweepApi>()("ops");
const sweeper: SweepApi = { sweep: () => Promise.resolve({ swept: true }) };

const cronFamily = defineRestRouter(SweepApi)
  .withNamespace("cron")
  .withVersion("2026-10-06")
  .withCredential("internal_secret")
  .withAddressing("literal")
  .post("/api/cron/sweep", "sweep")
  .withAccess(anyAuthenticated({ reason: "the deployment's cron bearer is the whole gate" }))
  .withOutput(z.object({ swept: z.literal(true) }))
  .handle(({ app }) => app.sweep())
  .build();

const members: ProcessMemberSource = {
  order: [],
  read: (name) => {
    throw new Error(`the shared-secret supply reads no ${name}`);
  },
  close: () => Promise.resolve(),
  [Symbol.asyncDispose]: () => Promise.resolve(),
};

const composition: ApiSurfaceComposition = {
  members,
  logger: createLogger("process-server:shared-secret-supply-test"),
  stores: { database: false, redis: false },
  bundle: void 0,
  storage: {},
  internalBearers: {},
  instanceAdmin: bearerDoor({ name: "instance-admin", token: void 0 }),
  trustedProxies: void 0,
  executionProxyBaseUrl: void 0,
  publicBaseUrl: void 0,
  production: false,
  selection: TransportSelection.create().rest().browserBundle(false),
  sockets: WebSocketHost.create(),
  doors: RawHttpHost.create(),
};

const CRON_KEY = "cron-key-0000000000000000";
const cron = bearerDoor({ name: "cron", token: CRON_KEY });

describe("given a process supplying the deployment's own shared secrets", () => {
  describe("when one is given under a name no door guards", () => {
    /** @scenario "A misspelled shared secret is refused where it is written" */
    it("is refused by the compiler and at composition, rather than guarding nothing", () => {
      expect(() =>
        apiSurface({
          ...composition,
          // @ts-expect-error no door guards a "crn" family: the compiler refuses the name here
          internalBearers: { crn: cron },
        }),
      ).toThrow(/No door guards the shared secret supplied as "crn"; .* "cron"/);
    });
  });

  describe("when one is given under the name its door guards", () => {
    it("guards that family: the right bearer passes and any other is refused", async () => {
      const surface = apiSurface({ ...composition, internalBearers: { cron } })(
        peersWithDoor({ resolve: () => ({}) }),
      );
      surface.hosts.rest?.mount(cronFamily.router(), () => sweeper);
      const handler = surface.serve();
      if (!isNodeHandler(handler)) throw new Error("the api surface composed no handler");
      const server = createServer(handler);
      await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("the test server has no port");
      const sweep = (token: string) =>
        fetch(`http://127.0.0.1:${address.port}/api/cron/sweep`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });

      const admitted = await sweep(CRON_KEY);
      const refused = await sweep("someone-else-0000000000000000");

      expect(admitted.status).toBe(200);
      await expect(admitted.json()).resolves.toEqual({ swept: true });
      expect(refused.status).toBe(401);
      await new Promise<void>((closed) => server.close(() => closed()));
    });
  });
});

function isNodeHandler(value: unknown): value is NodeHandler {
  return typeof value === "function";
}
