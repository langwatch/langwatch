import { AuthzApi } from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { WebhookApi } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { gatewayServer } from "../../gateway.server.ts";
import type { GatewaySpendApp } from "../../transport/gateway-spend.rest.ts";
import type { GatewayApp } from "../gateway.app.ts";

/**
 * `withTransports` type-checks a family's declared Api, never the App the
 * module provides, so a member the four `/api/gateway/v1` spend routes read
 * off `GatewaySpendApp` can go missing from `GatewayApp` and still compile.
 * This is the one compile-time proof that the mount is whole.
 */
type GatewayAppServesSpend = GatewayApp extends GatewaySpendApp ? true : never;
const spendFamilyIsWhole: GatewayAppServesSpend = true;

/**
 * The two members `GatewayApp` declares it reads. Nothing in a boot touches a
 * store — the control plane only constructs repositories over them — so each
 * member has to EXIST and refuses on first use, which keeps "the installation
 * test reached a datastore" a named failure rather than a silent query.
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
      } finally {
        await runtime.stop();
      }
    });

    /**
     * Recorded, not accepted. `moduleApi` resolves to a proxy that answers
     * callable operations ONLY (`packages/runtime-composition/src/local-feature-api.ts`),
     * and both `runtime.service(GatewayApi)` and `runtime.module(...).provided`
     * ARE that proxy — so the six property members the four `/api/gateway/v1`
     * spend routes read (`spendEvents`, `budgetSpend`, `webhookEndpoints`,
     * `webhookEvents`, `webhookDelivery`, `settlementPolicy`) throw a
     * TypeError at request time no matter what the control plane holds. This
     * test pins the defect so the fix — the six becoming methods on both
     * `GatewayApp` and `GatewaySpendApp` — deletes it rather than silently
     * passing.
     */
    it("cannot yet answer a property member through the module API", async () => {
      const runtime = await process().boot();

      try {
        const installed = runtime.module(gatewayServer).provided;

        expect(() => installed.spendEvents).toThrow(/exposes operations only/);
      } finally {
        await runtime.stop();
      }
    });
  });
});
