import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { GatewayApi } from "@langwatch/gateway-contract";
import { createApp } from "@langwatch/kernel";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { resolvedSecrets } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import { gatewayServer } from "../../gateway.server.ts";
import type { GatewaySpendApp } from "../../transport/gateway-spend.rest.ts";
import type { GatewayApp } from "../gateway.app.ts";

/**
 * `withTransports` type-checks a family's declared Api, never its App, so a
 * member the spend routes read off `GatewaySpendApp` could go missing from
 * `GatewayApp` and still compile. The one proof the mount is whole.
 */
type GatewayAppServesSpend = GatewayApp extends GatewaySpendApp ? true : never;
const spendFamilyIsWhole: GatewayAppServesSpend = true;

/**
 * The two members `GatewayApp` declares it reads. Boot touches no store —
 * the control plane only constructs repositories — so each must EXIST and
 * refuse on first use, naming "the test reached a datastore" as a failure.
 */
function relationalWithoutStore(): PrismaClient {
  const client: Partial<PrismaClient> = {};
  return new Proxy(client, {
    get(_target, property) {
      throw new Error(
        `Installing the gateway must not reach Postgres (read "${String(property)}").`,
      );
    },
  }) as PrismaClient;
}

function analyticalWithoutStore(): ClickHouseQueryClient {
  const client: Partial<ClickHouseQueryClient> = {};
  return new Proxy(client, {
    get(_target, property) {
      throw new Error(
        `Installing the gateway must not reach ClickHouse (read "${String(property)}").`,
      );
    },
  }) as ClickHouseQueryClient;
}

/** A peer that answers nothing: the boot resolves it, no test call reaches it. */
function peer(name: string): never {
  return new Proxy(
    {},
    {
      get(_target, property) {
        // Inspection (Symbol.toStringTag, util.inspect) is not a call: a peer
        // handed back through an app method may be looked at, never invoked.
        if (typeof property === "symbol") return undefined;
        throw new Error(`The ${name} peer was called for "${String(property)}".`);
      },
    },
  ) as never;
}

function process() {
  return createApp({ role: "api" })
    .withModules([gatewayServer])
    .withConfig({
      gateway: {
        spendSettlementGraceMs: undefined,
      },
    })
    .withRelational(relationalWithoutStore())
    .withAnalytical(analyticalWithoutStore())
    .withSecrets(resolvedSecrets({}))
    .withMember("elevenLabsWebhook", undefined)
    .withMember("gatewayInternalProtocol", {})
    .provide({
      webhook: peer("webhook"),
      entitlement: peer("entitlement"),
      authz: peer("authz"),
      project: peer("project"),
      evaluator: peer("evaluator"),
      monitor: peer("monitor"),
      organization: peer("organization"),
      "feature-flag": peer("featureFlag"),
    });
}

describe("gateway app installation", () => {
  describe("given a process that supplied the members and the peers", () => {
    it("serves the control plane instead of refusing by name", async () => {
      const runtime = await process().boot();

      try {
        const app = runtime.service(GatewayApi);

        expect(runtime.module(gatewayServer).provided).toBe(app);
        expect(spendFamilyIsWhole).toBe(true);

        // Each of these reads `#dependencies`, which is what threw "The
        // gateway control plane was not installed" on every process while the
        // App was handed an empty member record.
        const installed = runtime.module(gatewayServer).provided;
        expect(installed.isSpendSourceAvailable()).toBe(true);
        expect(installed.parseVirtualKeyBudget({ limitUsd: "10.00", window: "DAY" }).success).toBe(
          true,
        );
        expect(typeof installed.findVirtualKeyBySecret).toBe("function");
        expect(typeof installed.submitSpendCommands).toBe("function");
      } finally {
        await runtime.stop();
      }
    });
  });
});
