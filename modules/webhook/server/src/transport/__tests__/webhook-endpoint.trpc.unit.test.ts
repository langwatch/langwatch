/**
 * @vitest-environment node
 * The `webhookEndpoints` transport over the real runtime and a real endpoint
 * store: the scope per procedure, the plan gate, and the secret-once contract.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { WebhookEndpointsNotEntitledError } from "@langwatch/webhook-contract";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PrismaWebhookEndpointRepository,
  type WebhookEndpointDeps,
} from "../../repositories/prisma/prisma.webhook-endpoint.repository.ts";
import { WebhookApp } from "../../app/webhook.app.ts";
import { WebhookId } from "../../app/webhook.app.ts";
import { WebhookSecret } from "../../app/webhook.app.ts";
import { webhookEndpointTrpcTransport } from "../webhook-endpoint.trpc.ts";
import {
  webhookEndpointTrpcTestPorts,
  type WebhookEndpointTrpcTestContext,
} from "./webhook-endpoint.trpc.harness.ts";

const ORG_ID = "org_1";

const ENDPOINT_ROW = {
  id: "whep_1",
  organizationId: ORG_ID,
  destinationKind: "http",
  url: "https://example.com/hook",
  maxBatchSize: 100,
  maxBatchDelayMs: 1000,
  maxInFlight: 4,
  enabledEvents: ["gateway.request.completed"],
  status: "ACTIVE",
  disabledReason: null,
  disabledAt: null,
  failingSince: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  archivedAt: null,
  secretEncrypted: "encrypted-material",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
};

class TestId implements WebhookId {
  private next = 0;
  newEndpointId(): string {
    this.next += 1;
    return `whep_${this.next}`;
  }
}

/**
 * Secret material at rest is encrypted under the deployment's key. The contract
 * this file pins is about where the PLAINTEXT travels, so the cipher stands in
 * as an identity pair and the assertions hold anywhere.
 */
class TestSecret implements WebhookSecret {
  encrypt(value: string): string {
    return `encrypted:${value}`;
  }
  decrypt(value: string): string {
    return value.replace(/^encrypted:/, "");
  }
}

let entitled = true;

function buildMockPrisma() {
  return {
    webhookEndpoint: {
      findMany: vi.fn<() => Promise<unknown>>().mockResolvedValue([ENDPOINT_ROW]),
      findFirst: vi.fn<() => Promise<unknown>>().mockResolvedValue(ENDPOINT_ROW),
      create: vi.fn<() => Promise<unknown>>().mockResolvedValue(ENDPOINT_ROW),
      update: vi.fn<() => Promise<unknown>>().mockResolvedValue(ENDPOINT_ROW),
    },
  };
}

function mount(options: { prisma?: ReturnType<typeof buildMockPrisma>; denied?: string[] } = {}) {
  const prisma = options.prisma ?? buildMockPrisma();
  const endpoints = PrismaWebhookEndpointRepository.create({
    prisma: prisma as unknown as WebhookEndpointDeps["prisma"],
    ids: new TestId(),
    secrets: new TestSecret(),
  });

  // The two capabilities below belong to the REST door — the delivery health
  // report and the test fire's delivery hop — and no procedure on this surface
  // that the tests below call reaches them. They throw rather than answering so
  // a future procedure that does reach one fails loudly here instead of passing
  // against a silent stub.
  const app = WebhookApp.create({
    endpoints,
    health: {
      health: () => {
        throw new Error("Delivery health is not exercised by these scenarios");
      },
    },
    events: undefined,
    assertEndpointsEntitled: async () => {
      if (!entitled) throw new WebhookEndpointsNotEntitledError();
    },
    dispatch: () => {
      throw new Error("The test fire is a REST-only path");
    },
  });

  const trpc = initTRPC.context<WebhookEndpointTrpcTestContext>().create();
  const { ports, seenPermissions } = webhookEndpointTrpcTestPorts(new Set(options.denied ?? []));
  const router = createTrpcRuntime<WebhookEndpointTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports,
  }).mount(webhookEndpointTrpcTransport, () => app);

  return {
    prisma,
    router,
    seenPermissions,
    caller: router.createCaller({ actor: { id: "user_1" } }),
  };
}

describe("the webhookEndpoints tRPC namespace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entitled = true;
  });

  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "archive",
        "create",
        "deliveries",
        "disable",
        "enable",
        "eventTypes",
        "health",
        "list",
        "rollSecret",
        "update",
      ]);
    });

    it("reads with a query and changes with a mutation", () => {
      const { router } = mount();
      const kinds = Object.fromEntries(
        Object.entries(router._def.procedures).map(([name, procedure]) => [
          name,
          (procedure as { _def: { type: string } })._def.type,
        ]),
      );

      expect(kinds).toEqual({
        eventTypes: "query",
        list: "query",
        deliveries: "query",
        create: "mutation",
        health: "query",
        update: "mutation",
        rollSecret: "mutation",
        enable: "mutation",
        disable: "mutation",
        archive: "mutation",
      });
    });
  });

  describe("given reads and mutations across the surface", () => {
    /** @scenario Read procedures require the view scope and mutations the manage scope */
    it("maps view scopes to reads and manage scopes to mutations", async () => {
      const { caller, seenPermissions } = mount();

      await caller.list({ organizationId: ORG_ID });
      await caller.eventTypes({ organizationId: ORG_ID });
      await caller.disable({ organizationId: ORG_ID, endpointId: "whep_1" });

      expect(seenPermissions).toEqual([
        "webhookEndpoints:view",
        "webhookEndpoints:view",
        "webhookEndpoints:manage",
      ]);
    });
  });

  describe("when the check refuses the declared scope", () => {
    /** @scenario A denied scope rejects before any service call */
    it("rejects before any service call", async () => {
      const { caller, prisma } = mount({ denied: ["webhookEndpoints:manage"] });

      await expect(
        caller.create({
          organizationId: ORG_ID,
          url: "https://example.com/hook",
          enabledEvents: ["gateway.request.completed"],
        }),
      ).rejects.toThrow("You do not have permission");
      expect(prisma.webhookEndpoint.create).not.toHaveBeenCalled();
    });
  });

  describe("when the organization's plan lacks the entitlement", () => {
    /** @scenario Sessions of organizations without the plan flag are refused */
    it("refuses the procedure", async () => {
      entitled = false;

      await expect(mount().caller.list({ organizationId: ORG_ID })).rejects.toThrow(
        /enterprise feature/i,
      );
    });
  });

  describe("given a minted and a rolled signing secret", () => {
    /** @scenario The session surface returns the secret only from create and roll mutations */
    it("returns the secret from create and roll but never from list", async () => {
      const { caller } = mount();

      const created = await caller.create({
        organizationId: ORG_ID,
        url: "https://example.com/hook",
        enabledEvents: ["gateway.request.completed"],
      });
      expect(created.secret).toMatch(/^whsec_/);

      const listed = await caller.list({ organizationId: ORG_ID });
      const flat = JSON.stringify(listed);
      expect(flat).not.toContain("whsec_");
      expect(flat).not.toContain("secret");

      const rolled = await caller.rollSecret({
        organizationId: ORG_ID,
        endpointId: created.endpoint.id,
      });
      expect(rolled.secret).toMatch(/^whsec_/);
      expect(rolled.secret).not.toBe(created.secret);
    });
  });

  describe("when an event selector names nothing the catalog knows", () => {
    /**
     * @scenario Unknown event selectors surface as a bad request in the session surface
     *
     * Asserted on the handled `code` as well as on `BAD_REQUEST`. The refusal is
     * a `webhook_endpoint_invalid` carrying a 400, and the runtime is what turns
     * that status into the transport's code — this transport builds no
     * `TRPCError` of its own, and the domain error reaches the boundary intact
     * on the `cause`.
     */
    it("refuses with the endpoint's own validation code", async () => {
      await expect(
        mount().caller.create({
          organizationId: ORG_ID,
          url: "https://example.com/hook",
          enabledEvents: ["nonsense.event"],
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        cause: { code: "webhook_endpoint_invalid", httpStatus: 400 },
      });
    });
  });
});
