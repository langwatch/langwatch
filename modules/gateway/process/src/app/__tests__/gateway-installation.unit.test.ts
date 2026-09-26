import { createApiFixture } from "@langwatch/api-fixture";
import { BearerIdentity, RestHost, type RestCredentialBinding } from "@langwatch/api/rest";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { ProcessStore } from "@langwatch/eventing";
import { GatewayApi } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { gatewayRealtimeSessionEventing } from "../../eventing/gateway-realtime-session.pipeline.ts";
import { gatewaySpendEventing } from "../../eventing/gateway-spend.pipeline.ts";
import { gatewayServer } from "../../gateway.server.ts";
import {
  buildGatewayCanonicalString,
  computeGatewaySignature,
} from "../../rules/gateway-internal-identity.rules.ts";
import { gatewayInternalRest } from "../../transport/gateway-internal.rest.ts";
import type { GatewaySpendApp } from "../../transport/gateway-spend.rest.ts";
import { GatewayApp } from "../gateway.app.ts";

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

const INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";

async function installGateway() {
  const resources = new ResourceScope();
  const secrets = new ScopedSecrets(async (handle, build) =>
    build(handle.id === "LW_GATEWAY_INTERNAL_SECRET" ? INTERNAL_SECRET : undefined),
  );

  try {
    const state = await gatewayServer.install({
      resources,
      config: { spendSettlementGraceMs: undefined },
      members: {
        prisma: relationalWithoutStore(),
        clickhouse: analyticalWithoutStore(),
        gatewayInternalProtocol: {},
        encryption: createApiFixture<Encryption>(),
      },
      role: "api",
      secrets,
      resolve: () => peer("gateway dependency"),
    });

    return { state, resources };
  } catch (error) {
    await resources.close();
    throw error;
  }
}

function signedHealthRequest(): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const path = "/api/internal/gateway/health";
  const signature = computeGatewaySignature(
    INTERNAL_SECRET,
    buildGatewayCanonicalString({ method: "GET", path, timestamp, body: "" }),
  );

  return new Request(`http://api.test${path}`, {
    headers: {
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
    },
  });
}

function isInternalCredential(binding: object): binding is RestCredentialBinding {
  return (
    "credential" in binding &&
    binding.credential === "internalSecret" &&
    "resolveIdentity" in binding &&
    typeof binding.resolveIdentity === "function"
  );
}

describe("gateway app installation", () => {
  describe("given a process that supplied the members and the peers", () => {
    it("serves the control plane instead of refusing by name", async () => {
      const { state, resources } = await installGateway();

      try {
        const app = state.provided;
        if (!(app instanceof GatewayApp)) {
          throw new Error("Gateway installation did not provide GatewayApp");
        }
        const credential = state.facts?.find(isInternalCredential);
        if (!credential)
          throw new Error("Gateway installation did not bind its internal credential");

        expect(GatewayApp.contract).toBe(GatewayApi);
        expect(spendFamilyIsWhole).toBe(true);
        expect(credential.resolveIdentity()).toBe(app.internalDoor);

        const closed = BearerIdentity.create({ name: "unconfigured", token: undefined });
        const runtime = RestHost.create({
          identities: {
            project: closed,
            organization: closed,
            apiKey: closed,
            scimToken: closed,
            "instance-admin": closed,
            browser: closed,
          },
          bearers: () => closed,
          audit: { record: async () => undefined },
        });
        runtime.mount(gatewayInternalRest.router(), () => app, {
          facts: state.facts,
        });

        const health = await runtime.app.request(signedHealthRequest());
        expect(health.status).toBe(200);

        // Each of these reads `#dependencies`, which is what threw "The
        // gateway control plane was not installed" on every process while the
        // App was handed an empty member record.
        const installed = app;
        expect(installed.isSpendSourceAvailable()).toBe(true);
        expect(installed.parseVirtualKeyBudget({ limitUsd: "10.00", window: "DAY" }).success).toBe(
          true,
        );
        expect(typeof installed.findVirtualKeyBySecret).toBe("function");
        expect(typeof installed.submitSpendCommands).toBe("function");
      } finally {
        await resources.close();
      }
    });

    /** @scenario "The spend pipeline is registered in both roles" */
    it("builds gateway_spend_processing for the api and for the worker", async () => {
      const { state, resources } = await installGateway();

      try {
        const app = state.provided;
        if (!(app instanceof GatewayApp)) {
          throw new Error("Gateway installation did not provide GatewayApp");
        }
        const setup = {
          repositories: undefined,
          app,
          processStore: createApiFixture<ProcessStore>(),
        };

        const produced = gatewaySpendEventing.build({ ...setup, participation: "produce" });
        const consumed = gatewaySpendEventing.build({ ...setup, participation: "consume" });

        expect(gatewayServer.eventing?.pipeline).toContain("gateway_spend_processing");
        expect(produced.metadata.name).toBe("gateway_spend_processing");
        expect(consumed.metadata.name).toBe("gateway_spend_processing");
        expect([...consumed.foldProjections.keys()]).toHaveLength(1);
      } finally {
        await resources.close();
      }
    });

    it("builds the voice reconciler as a process manager scheduled once a minute", async () => {
      const { state, resources } = await installGateway();

      try {
        const app = state.provided;
        if (!(app instanceof GatewayApp)) {
          throw new Error("Gateway installation did not provide GatewayApp");
        }
        const maintenance = gatewayRealtimeSessionEventing.build({
          repositories: undefined,
          app,
          processStore: createApiFixture<ProcessStore>(),
          participation: "consume",
        });

        expect(gatewayServer.eventing?.pipeline).toContain("gateway_realtime_session_maintenance");
        expect(
          maintenance.processManagers.get("gatewayRealtimeSessionReconcile")?.config.schedule,
        ).toEqual({ everyMs: 60_000 });
      } finally {
        await resources.close();
      }
    });
  });
});
