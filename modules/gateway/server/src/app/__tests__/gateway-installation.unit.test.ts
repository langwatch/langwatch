import { AuthzApi } from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { WebhookApi } from "@langwatch/webhook-contract";
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
function membersWithoutStores() {
  const refusing = (member: string) =>
    new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(
            `Installing the gateway must not reach ${member} (read "${String(property)}").`,
          );
        },
      },
    );

  return {
    order: ["prisma", "clickhouse"] as const,
    read(name: string): unknown {
      if (name !== "prisma" && name !== "clickhouse") {
        throw new Error(`This process opened no clients, so it cannot read the "${name}" member.`);
      }

      return refusing(name);
    },
    async close() {},
  };
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
  return createApp({
    role: "api",
    config: {
      gateway: {
        internalSecret: undefined,
        jwtSecret: undefined,
        virtualKeyPepper: undefined,
        spendSettlementGraceMs: undefined,
      },
    },
    members: membersWithoutStores() as never,
  })
    .withProvided(WebhookApi, peer("webhook"))
    .withProvided(EntitlementApi, peer("entitlement"))
    .withProvided(AuthzApi, peer("authz"))
    .withProvided(ProjectApi, peer("project"))
    .withProvided(EvaluatorApi, peer("evaluator"))
    .withProvided(MonitorApi, peer("monitor"))
    .withProvided(OrganizationApi, peer("organization"))
    .withProvided(FeatureFlagApi, peer("featureFlag"))
    .withModules([gatewayServer]);
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
        expect(installed.getVirtualKeySpendService()).toBeDefined();
        expect(installed.parseVirtualKeyBudget({ limitUsd: "10.00", window: "DAY" }).success).toBe(
          true,
        );
        expect(
          installed.endpointAcceptsEvent({
            enabledEvents: ["gateway.spend.settled"],
            eventType: "gateway.spend.settled",
          }),
        ).toBe(true);

        // `moduleApi` resolves to a proxy that answers callable operations
        // ONLY (`packages/runtime-composition/src/local-feature-api.ts`), and
        // both `runtime.service(GatewayApi)` and `runtime.module(...).provided`
        // ARE that proxy — so the six members the four `/api/gateway/v1` spend
        // routes read are methods, not properties, and answer through a call.
        expect(installed.spendEvents()).toBeDefined();
        expect(installed.budgetSpend()).toBeDefined();
        expect(installed.webhookEndpoints()).toBeDefined();
        expect(installed.webhookEvents()).toBeDefined();
        // The replay path resolves through the webhook peer itself now that
        // WebhookApi publishes appendReplayToEndpointStream — same reference,
        // no second delivery path of the gateway's own.
        expect(Object.is(installed.webhookDelivery(), installed.webhookEvents())).toBe(true);
        expect(installed.settlementPolicy()).toBeDefined();
      } finally {
        await runtime.stop();
      }
    });
  });
});
