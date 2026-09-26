/**
 * `/api/gateway/v1` through the production error mapping: what the wire
 * promises before any service rule runs.
 * @see specs/ai-gateway/public-rest-api.feature
 */

// @vitest-environment node
import { ProjectMissingCredentialsError } from "@langwatch/api";
import { createApiFixture } from "@langwatch/api-fixture";
import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import {
  canonicalErrorResponse,
  createRestRuntime,
  type IdempotentRunner,
} from "@langwatch/api/rest";
import { type GatewayApi, type GatewayVirtualKeySnakeDto } from "@langwatch/gateway-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { virtualKeyRow } from "../../app/__tests__/gateway-virtual-key.fixture.ts";
import { gatewayPlatformRest } from "../gateway-platform.rest.ts";

const PROJECT_ID = "project_caller";
const ORGANIZATION_ID = "organization_1";

const virtualKeyDto: GatewayVirtualKeySnakeDto = {
  id: "vk_1",
  organization_id: ORGANIZATION_ID,
  name: "k",
  description: null,
  status: "active",
  purpose: "user",
  display_prefix: "lw_",
  principal_user_id: null,
  trace_project_id: null,
  trace_project_archived: false,
  external_id: null,
  metadata: {},
  scopes: [{ scope_type: "project", scope_id: PROJECT_ID }],
  routing_policy_id: null,
  routing_mode: "none",
  config: {},
  revision: "1",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  last_used_at: null,
  revoked_at: null,
  expires_at: null,
};

/** The fields these scenarios read off an answer, success or canonical envelope. */
const wireBody = z.object({
  type: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  spent_usd: z.string().optional(),
  requests: z.number().optional(),
  window: z.object({ from: z.number(), to: z.number() }).optional(),
});

const passthroughIdempotency: IdempotentRunner = async ({ handler }) => {
  const response = await handler();
  return { isReplayed: false, status: response.status, response };
};

function mount(overrides: Partial<GatewayApi> = {}, refuse?: () => never) {
  const app = createApiFixture<GatewayApi>({
    organizationIdForProject: async () => ORGANIZATION_ID,
    ...overrides,
  });
  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ request }: { request: Request }) => {
        if (!request.headers.get("Authorization")) throw new ProjectMissingCredentialsError();
        if (refuse) refuse();
        return {
          actor: { type: "api_key", id: "gateway-key" },
          scope: { tier: "project", id: PROJECT_ID },
        };
      },
    },
    idempotency: passthroughIdempotency,
  });
  const hono = runtime.mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
  });
  return async (
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string>; anonymous?: boolean } = {},
  ) => {
    const response = await hono.request(`/api/gateway/v1${path}`, {
      method,
      headers: {
        ...(init.anonymous ? {} : { Authorization: "Bearer sk-lw-test" }),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { status: response.status, body: wireBody.parse(await response.json()) };
  };
}

describe("the gateway platform family's public wire", () => {
  describe("given a request with no credential", () => {
    /** @scenario Reject unauthenticated gateway REST calls */
    /** @scenario An unauthenticated request answers the canonical error envelope */
    it("answers 401 with the canonical unauthenticated envelope", async () => {
      const answer = await mount()("GET", "/virtual-keys", { anonymous: true });

      expect(answer.status).toBe(401);
      expect(answer.body).toMatchObject({ type: "unauthenticated", code: "missing_credentials" });
    });
  });

  describe("given a credential the API key ceiling refuses", () => {
    /** @scenario Every gateway platform refusal is the canonical envelope */
    it("answers 403 with the canonical permission_denied envelope", async () => {
      const call = mount({}, () => {
        throw new ApiKeyPermissionDeniedError("virtualKeys:create");
      });
      const answer = await call("POST", "/virtual-keys", { body: { name: "ci-key" } });

      expect(answer.status).toBe(403);
      expect(answer.body).toMatchObject({
        type: "permission_denied",
        code: "api_key_permission_denied",
      });
    });
  });

  describe("given a body that fails its schema", () => {
    /** @scenario A request-validation failure answers the canonical error envelope at 422 */
    it("answers 422 validation_error with one reason per violation", async () => {
      const answer = await mount()("POST", "/virtual-keys", {
        body: { name: "", routing_mode: "sideways" },
      });

      expect(answer.status).toBe(422);
      expect(answer.body.code).toBe("validation_error");
      expect(answer.body.meta?.target).toBe("json");
      expect(answer.body.meta?.reasons).toHaveLength(2);
    });

    /** @scenario The product-managed purpose cannot be minted over REST */
    it("refuses a product-managed purpose as a validation error", async () => {
      const createVirtualKey = vi.fn();
      const answer = await mount({ createVirtualKey })("POST", "/virtual-keys", {
        body: { name: "k", purpose: "langy" },
      });

      expect(answer.status).toBe(422);
      expect(answer.body.code).toBe("validation_error");
      expect(createVirtualKey).not.toHaveBeenCalled();
    });

    /** @scenario Metadata beyond the documented caps is refused, naming the key */
    it("refuses an oversized value naming its key, and a map past forty keys", async () => {
      const call = mount();
      const long = await call("POST", "/virtual-keys", {
        body: { name: "k", metadata: { tier: "x".repeat(501) } },
      });
      const wide = await call("POST", "/virtual-keys", {
        body: {
          name: "k",
          metadata: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, "v"])),
        },
      });

      expect(long.status).toBe(422);
      expect(JSON.stringify(long.body.meta)).toContain("metadata.tier");
      expect(wide.status).toBe(422);
      expect(wide.body.code).toBe("validation_error");
    });

    /** @scenario The wire enums are lowercase only, with no casing tolerance */
    it("refuses the stored casing on a budget kind and a key scope_type", async () => {
      const call = mount();
      const kind = await call("POST", "/budgets", {
        body: {
          scope: { kind: "PROJECT", project_id: PROJECT_ID },
          name: "b",
          window: "month",
          limit_usd: "1",
        },
      });
      const scopeType = await call("POST", "/virtual-keys", {
        body: { name: "k", scopes: [{ scope_type: "PROJECT", scope_id: PROJECT_ID }] },
      });

      expect([kind.status, kind.body.code]).toEqual([422, "validation_error"]);
      expect([scopeType.status, scopeType.body.code]).toEqual([422, "validation_error"]);
    });
  });

  describe("given a handler that fails unexpectedly", () => {
    /** @scenario An unexpected server failure answers the canonical error envelope naming nothing internal */
    it("answers 500 internal_error without the failure's own words", async () => {
      const answer = await mount({
        getVirtualKeyPage: async () => {
          throw new Error('relation "VirtualKey" does not exist at pg.internal:5432');
        },
      })("GET", "/virtual-keys");

      expect(answer.status).toBe(500);
      expect(answer.body.code).toBe("internal_error");
      expect(JSON.stringify(answer.body)).not.toMatch(/VirtualKey|pg\.internal|5432/);
    });
  });

  describe("given a create that still carries provider_credential_ids", () => {
    /** @scenario Ghost provider_credential_ids no longer gates creation */
    it("mints the key regardless", async () => {
      const row = virtualKeyRow();
      const answer = await mount({
        authorizeVirtualKeyCreate: async () => {},
        createVirtualKey: async () => ({ virtualKey: row, secret: "vk-lw-secret" }),
        toVirtualKeySnakeDto: async () => virtualKeyDto,
      })("POST", "/virtual-keys", { body: { name: "k", provider_credential_ids: ["pc_ghost"] } });

      expect(answer.status).toBe(201);
    });
  });

  describe("given list and spend reads", () => {
    const visibleKey = {
      getVisibleVirtualKeyForProjectCredential: async () => virtualKeyRow(),
      isSpendSourceAvailable: () => true,
      spendByVirtualKey: async () => new Map(),
    };

    /** @scenario A fresh key reports zero spend for the current month */
    it("reports zero from the first of the current UTC month", async () => {
      const answer = await mount(visibleKey)("GET", "/virtual-keys/vk_1/spend");
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({ spent_usd: "0", requests: 0 });
      expect(answer.body.window?.from).toBe(monthStart.getTime());
    });

    /** @scenario Provider binding routes are gone since the ModelProvider fold */
    it("answers gone, pointing at the model-provider address", async () => {
      const answer = await mount()("GET", "/providers");

      expect(answer.status).toBe(410);
      expect(answer.body).toMatchObject({ type: "gone", code: "gateway_provider_bindings_gone" });
      expect(answer.body.message).toContain("/api/gateway/v1/model-providers");
    });
  });

  describe("given an Idempotency-Key too short to be one", () => {
    /** @scenario An unusable idempotency key is refused before anything is created */
    it("answers 422 naming the header and creates nothing", async () => {
      const createBudget = vi.fn();
      const answer = await mount({
        authorizeOrganizationWideOperation: async () => {},
        createBudget,
      })("POST", "/budgets", {
        body: {
          scope: { kind: "project", project_id: PROJECT_ID },
          name: "b",
          window: "month",
          limit_usd: "1",
        },
        headers: { "Idempotency-Key": "short" },
      });

      expect([answer.status, answer.body.code]).toEqual([422, "validation_error"]);
      expect(answer.body.meta?.target).toBe("header");
      expect(createBudget).not.toHaveBeenCalled();
    });
  });
});
