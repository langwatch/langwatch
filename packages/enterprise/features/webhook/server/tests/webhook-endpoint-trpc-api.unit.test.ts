/**
 * @vitest-environment node
 *
 * The `webhookEndpoints` transport: the declared scope per procedure, the
 * enterprise plan gate, and the secret-once contract — the signing secret
 * appears only in the create and rollSecret responses and never on a read.
 *
 * Moved here with the surface. The endpoint service under test is the real one,
 * over a stubbed Prisma client and an identity cipher: what the secret-once
 * contract needs is that the plaintext reaches create and rollSecret and no read
 * path, which holds anywhere. The refusal case stands on the policy the process
 * hands in rather than on the app's RBAC middleware; the transport's side of
 * that contract is that the handler never runs when the policy refuses.
 *
 * @see specs/webhooks/webhook-endpoints.feature
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookEndpointsNotEntitledError } from "@langwatch/enterprise-webhook-contract";
import { WebhookEndpointAdapter } from "../src/adapters/webhook-endpoint.webhook-endpoint.adapter";
import { WebhookIdPort } from "../src/ports/webhook-id.port";
import { WebhookSecretPort } from "../src/ports/webhook-secret.port";
import { WebhookApp } from "../src/app/webhook.app";
import { WebhookEndpointTrpcApi } from "../src/api/app-trpc/webhook-endpoint.api";

const ORG_ID = "org_1";

const ENDPOINT_ROW = {
  id: "whep_1",
  organizationId: ORG_ID,
  url: "https://example.com/hook",
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

class TestIdPort extends WebhookIdPort {
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
class TestSecretPort extends WebhookSecretPort {
  encrypt(value: string): string {
    return `encrypted:${value}`;
  }
  decrypt(value: string): string {
    return value.replace(/^encrypted:/, "");
  }
}

const seenPermissions: string[] = [];
const denied = new Set<string>();
let entitled = true;

function buildMockPrisma() {
  return {
    webhookEndpoint: {
      findMany: vi.fn().mockResolvedValue([ENDPOINT_ROW]),
      findFirst: vi.fn().mockResolvedValue(ENDPOINT_ROW),
      create: vi.fn().mockResolvedValue(ENDPOINT_ROW),
      update: vi.fn().mockResolvedValue(ENDPOINT_ROW),
    },
  };
}

function buildCaller(prisma: ReturnType<typeof buildMockPrisma>) {
  const endpoints = WebhookEndpointAdapter.create({
    prisma,
    ids: new TestIdPort(),
    secrets: new TestSecretPort(),
  });

  // The three capabilities below belong to the REST door — the health report,
  // the test fire's delivery hop and the `Idempotency-Key` ledger — and no
  // procedure on this surface that the tests below call reaches them. They
  // throw rather than answering so a future procedure that does reach one
  // fails loudly here instead of passing against a silent stub.
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
    runIdempotent: () => {
      throw new Error("Idempotent replay is a REST-only path");
    },
  });

  const trpc = initTRPC
    .context<{ app: { webhooks: WebhookApp }; actor(): { id: string } }>()
    .create();

  const router = WebhookEndpointTrpcApi.create(trpc, {
    protected: trpc.procedure,
    policy: (permission) => (procedure) =>
      (procedure as { use(m: unknown): unknown }).use(({ next }: { next: () => unknown }) => {
        seenPermissions.push(permission);
        if (denied.has(permission)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission" });
        }
        return next();
      }) as typeof procedure,
  });

  return router.createCaller({
    app: { webhooks: app },
    actor: () => ({ id: "user_1" }),
  } as never);
}

describe("WebhookEndpointTrpcApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seenPermissions.length = 0;
    denied.clear();
    entitled = true;
  });

  describe("given reads and mutations across the surface", () => {
    /** @scenario Read procedures require the view scope and mutations the manage scope */
    it("maps view scopes to reads and manage scopes to mutations", async () => {
      const caller = buildCaller(buildMockPrisma());

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

  describe("when the policy refuses the declared scope", () => {
    /** @scenario A denied scope rejects before any service call */
    it("rejects before any service call", async () => {
      denied.add("webhookEndpoints:manage");
      const prisma = buildMockPrisma();

      await expect(
        buildCaller(prisma).create({
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

      await expect(buildCaller(buildMockPrisma()).list({ organizationId: ORG_ID })).rejects.toThrow(
        /enterprise feature/i,
      );
    });
  });

  describe("given a minted and a rolled signing secret", () => {
    /** @scenario The session surface returns the secret only from create and roll mutations */
    it("returns the secret from create and roll but never from list", async () => {
      const caller = buildCaller(buildMockPrisma());

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
     * Asserted on the handled `code` rather than on `BAD_REQUEST`. The refusal
     * is a `webhook_endpoint_invalid` carrying a 400, and the process's tRPC
     * policy is what turns that status into the transport's `BAD_REQUEST` —
     * this transport no longer builds one. The root here is a bare
     * `initTRPC` with a stub policy, so what reaches the caller is the
     * refusal itself, which is the thing this surface is responsible for.
     */
    it("refuses with the endpoint's own validation code", async () => {
      await expect(
        buildCaller(buildMockPrisma()).create({
          organizationId: ORG_ID,
          url: "https://example.com/hook",
          enabledEvents: ["nonsense.event"],
        }),
      ).rejects.toMatchObject({ code: "webhook_endpoint_invalid", httpStatus: 400 });
    });
  });
});
