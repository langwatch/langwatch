/**
 * `/api/gateway/v1` through the production error mapping: what the wire
 * promises before any service rule runs.
 * @see specs/ai-gateway/public-rest-api.feature
 */

// @vitest-environment node
import { ProjectMissingCredentialsError } from "@langwatch/api";
import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  type IdempotentRunner,
  type RestPermissionReach,
} from "@langwatch/api/rest";
import { PermissionDeniedError } from "@langwatch/authorization";
import {
  type GatewayApi,
  GatewayBudgetCycleAnchorInvalidError,
  GatewayCacheRuleNotFoundError,
  type GatewayRequestCredential,
  GatewaySpendSourceUnavailableError,
  type GatewayVirtualKeyRecord,
  type GatewayVirtualKeySnakeDto,
  VirtualKeyNotFoundError,
  virtualKeyBudgetInputSchema,
} from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { virtualKeyRow } from "../../app/__tests__/gateway-virtual-key.fixture.ts";
import {
  gatewayKeyCaller,
  gatewayVirtualKeyCaller,
  gatewayPlatformRest,
  gatewayRestCredential,
} from "../gateway-platform.rest.ts";

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
  data: z.array(z.object({ id: z.string() })).optional(),
  next_cursor: z.string().nullable().optional(),
  window: z.object({ from: z.number(), to: z.number() }).optional(),
});

const passthroughIdempotency: IdempotentRunner = async ({ handler }) => {
  const response = await handler();
  return { isReplayed: false, status: response.status, response };
};

/** What the key door was asked for one request: the route's permission and its declared reach. */
type KeyDoorQuestion = Readonly<{
  permission: string;
  reach: RestPermissionReach["at"] | undefined;
}>;

type KeyDoorInput = { request: Request; permission: string; reach?: RestPermissionReach["at"] };

function mount(
  overrides: Partial<GatewayApi> = {},
  refuse?: (question: KeyDoorQuestion) => void,
  asked: KeyDoorQuestion[] = [],
) {
  const app = createApiFixture<GatewayApi>({
    organizationIdForProject: async () => ORGANIZATION_ID,
    actorForCredential: ({ projectId }) => ({
      actor: { kind: "legacyProjectKey" },
      actorUserId: `svc_${projectId}`,
    }),
    getKeyCaller: async () => ({
      organizationId: ORGANIZATION_ID,
      actor: { kind: "legacyProjectKey" },
      actorUserId: `svc_${PROJECT_ID}`,
    }),
    getVirtualKeyCaller: async () => ({
      organizationId: ORGANIZATION_ID,
      actor: { kind: "legacyProjectKey" },
      actorUserId: `svc_${PROJECT_ID}`,
      projectId: PROJECT_ID,
    }),
    ...overrides,
  });
  const door = ({ request }: { request: Request }) => {
    if (!request.headers.get("Authorization")) throw new ProjectMissingCredentialsError();
    return {
      actor: { type: "api_key" as const, id: "gateway-key" },
      scope: { tier: "project" as const, id: PROJECT_ID },
    };
  };
  const identifyKey = ({ request }: { request: Request }) => ({
    ...door({ request }),
    scope: { tier: "organization" as const, id: ORGANIZATION_ID },
  });
  /** The key door reads the credential first, then answers the permission the route declared. */
  const authenticateKey = ({ request, permission, reach }: KeyDoorInput) => {
    const caller = identifyKey({ request });
    asked.push({ permission, reach });
    if (refuse) refuse({ permission, reach });
    return caller;
  };
  const runtime = createRestRuntime({
    identity: { authenticate: door, identify: door },
    doors: { api_key: { authenticate: authenticateKey, identify: identifyKey } },
    idempotency: passthroughIdempotency,
  });
  const hono = runtime.mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(gatewayRestCredential, (): GatewayRequestCredential => ({
        kind: "legacyProjectKey",
      })),
      bindRestMiddleware(gatewayKeyCaller, () => ({
        kind: "project" as const,
        projectId: PROJECT_ID,
      })),
      bindRestMiddleware(gatewayVirtualKeyCaller, () => ({
        kind: "project" as const,
        projectId: PROJECT_ID,
      })),
    ],
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
    /** @scenario A canonical family refuses unauthenticated calls canonically */
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

  describe("given a key the door refuses for the route's permission", () => {
    const refuseByPermission = ({ permission }: KeyDoorQuestion): never => {
      throw new PermissionDeniedError({
        permission,
        scope: { type: "organization", id: ORGANIZATION_ID },
        denialReason: "no-binding",
      });
    };

    it("answers 403 permission_denied on a virtual key route, asked at the key's grants", async () => {
      const asked: KeyDoorQuestion[] = [];
      const createVirtualKey = vi.fn();
      const call = mount({ createVirtualKey }, refuseByPermission, asked);

      const answer = await call("POST", "/virtual-keys", { body: { name: "ci-key" } });

      expect([answer.status, answer.body.code]).toEqual([403, "permission_denied"]);
      expect(answer.body.type).toBe("permission_denied");
      expect(asked).toEqual([{ permission: "virtualKeys:create", reach: "grants" }]);
      expect(createVirtualKey).not.toHaveBeenCalled();
    });

    it("answers 403 permission_denied on a budget write, asked at the organization", async () => {
      const asked: KeyDoorQuestion[] = [];
      const archiveBudget = vi.fn();
      const call = mount({ archiveBudget }, refuseByPermission, asked);

      const answer = await call("DELETE", "/budgets/bgt_1");

      expect([answer.status, answer.body.code]).toEqual([403, "permission_denied"]);
      expect(asked).toEqual([{ permission: "gatewayBudgets:delete", reach: "organization" }]);
      expect(archiveBudget).not.toHaveBeenCalled();
    });

    it("answers 403 permission_denied on a budget read, asked with no reach", async () => {
      const asked: KeyDoorQuestion[] = [];
      const listBudgetPageWithHealth = vi.fn();
      const call = mount({ listBudgetPageWithHealth }, refuseByPermission, asked);

      const answer = await call("GET", "/budgets");

      expect([answer.status, answer.body.code]).toEqual([403, "permission_denied"]);
      expect(asked).toStrictEqual([{ permission: "gatewayBudgets:view", reach: undefined }]);
      expect(listBudgetPageWithHealth).not.toHaveBeenCalled();
    });
  });

  describe("given a key whose grants are view only", () => {
    const viewerOnly = ({ permission }: KeyDoorQuestion): void => {
      if (permission === "virtualKeys:view") return;
      throw new PermissionDeniedError({
        permission,
        scope: { type: "project", id: PROJECT_ID },
        denialReason: "no-binding",
      });
    };

    /** @scenario A viewer-scoped API key can list but not create virtual keys */
    it("lists the keys with 200 and refuses to create one with 403", async () => {
      const createVirtualKey = vi.fn();
      const call = mount(
        {
          createVirtualKey,
          getVirtualKeyPage: async () => [],
          visibleToVirtualKeyCaller: async ({ virtualKeys }) => [...virtualKeys],
          toVirtualKeySnakeDtos: async () => [],
        },
        viewerOnly,
      );

      const listed = await call("GET", "/virtual-keys");
      const created = await call("POST", "/virtual-keys", { body: { name: "ci-key" } });

      expect(listed.status).toBe(200);
      expect([created.status, created.body.code]).toEqual([403, "permission_denied"]);
      expect(createVirtualKey).not.toHaveBeenCalled();
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
      getVirtualKeyForCaller: async () => virtualKeyRow(),
      getVirtualKeySpend: async () => ({ spentUsd: "0", requests: 0 }),
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

  describe("given a cursor this surface never minted", () => {
    /** @scenario A cursor this surface did not issue is refused */
    it("answers 400 invalid_cursor on every paged list, reading nothing", async () => {
      const reads = {
        getVirtualKeyPage: vi.fn(),
        listBudgetPageWithHealth: vi.fn(),
        listCacheRulePage: vi.fn(),
      };
      const call = mount(reads);
      const forged = Buffer.from("not-a-keyset", "utf8").toString("base64url");
      const answers = await Promise.all(
        ["/virtual-keys", "/budgets", "/cache-rules"].map((path) =>
          call("GET", `${path}?cursor=${forged}`),
        ),
      );

      expect(answers.map((a) => [a.status, a.body.code])).toEqual([
        [400, "invalid_cursor"],
        [400, "invalid_cursor"],
        [400, "invalid_cursor"],
      ]);
      expect(Object.values(reads).some((read) => read.mock.calls.length > 0)).toBe(false);
    });

    /** @scenario The page size is capped */
    it("answers the framework's 422 for a page past the cap", async () => {
      const answer = await mount()("GET", "/virtual-keys?limit=500");

      expect([answer.status, answer.body.code]).toEqual([422, "validation_error"]);
    });
  });

  describe("given more virtual keys than fit in one page", () => {
    const rows = ["vk_5", "vk_4", "vk_3", "vk_2", "vk_1"].map(
      (id, index): GatewayVirtualKeyRecord => ({
        ...virtualKeyRow(),
        id,
        createdAt: Temporal.Instant.fromEpochMilliseconds(1_760_000_000_000 - index * 1_000),
      }),
    );

    /** The store's keyset read: newest first, strictly after the cursor's row. */
    const getVirtualKeyPage = async ({
      limit,
      cursor,
    }: {
      limit: number;
      cursor: { createdAt: Instant; id: string } | null;
    }) =>
      rows
        .filter(
          (row) =>
            cursor === null || row.createdAt.epochMilliseconds < cursor.createdAt.epochMilliseconds,
        )
        .slice(0, limit);

    const pagedKeys = () =>
      mount({
        getVirtualKeyPage,
        visibleToVirtualKeyCaller: async ({ virtualKeys }) => [...virtualKeys],
        toVirtualKeySnakeDtos: async ({ virtualKeys }) =>
          virtualKeys.map((row) => ({ ...virtualKeyDto, id: row.id })),
      });

    /** @scenario An unbounded list is walked by cursor without loss or repeats */
    /** @scenario Every unbounded list takes the same page controls */
    it("collects exactly the single-page list by following next_cursor", async () => {
      const call = pagedKeys();
      const whole = await call("GET", "/virtual-keys?limit=50");
      const walked: string[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await call("GET", `/virtual-keys?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
        walked.push(...(page.body.data ?? []).map((row) => row.id));
        cursor = page.body.next_cursor;
      } while (cursor);

      expect(whole.body.next_cursor).toBeNull();
      expect(walked).toEqual((whole.body.data ?? []).map((row) => row.id));
      expect(new Set(walked).size).toBe(walked.length);
      expect(walked).toHaveLength(rows.length);
    });
  });

  describe("given a scope_type filter on the budget list", () => {
    /** @scenario A filtered list pages on rows returned, not rows examined */
    it("hands the filter and the page size to the same query", async () => {
      const listBudgetPageWithHealth = vi.fn().mockResolvedValue({
        budgets: [],
        spendAvailable: true,
        scopeReach: new Map(),
      });
      const answer = await mount({
        getKeyCaller: async () => ({
          organizationId: ORGANIZATION_ID,
          actor: { kind: "legacyProjectKey" },
          actorUserId: `svc_${PROJECT_ID}`,
        }),
        listBudgetPageWithHealth,
        groupMemberCounts: async () => new Map(),
      })("GET", "/budgets?scope_type=project&limit=3");

      expect(answer.status).toBe(200);
      expect(listBudgetPageWithHealth).toHaveBeenCalledWith(
        expect.objectContaining({ scopeTypes: ["PROJECT"], limit: 3 }),
      );
    });
  });

  describe("given a key id that does not exist", () => {
    /** @scenario Spend for an unknown key is a 404, not a zero */
    it("answers 404 and never reads a spend figure", async () => {
      const getVirtualKeySpend = vi.fn();
      const answer = await mount({
        getVirtualKeyForCaller: async () => {
          throw new VirtualKeyNotFoundError();
        },
        getVirtualKeySpend,
      })("GET", "/virtual-keys/vk_missing/spend");

      expect(answer.status).toBe(404);
      expect(getVirtualKeySpend).not.toHaveBeenCalled();
    });
  });

  describe("given a budget list filter", () => {
    /** @scenario An invalid scope_type filter is refused */
    it("answers 422 for a scope type the rows never carry, reading nothing", async () => {
      const listBudgetPageWithHealth = vi.fn();
      const answer = await mount({ listBudgetPageWithHealth })("GET", "/budgets?scope_type=BANANA");

      expect([answer.status, answer.body.code]).toEqual([422, "validation_error"]);
      expect(JSON.stringify(answer.body.meta)).toContain("scope_type");
      expect(listBudgetPageWithHealth).not.toHaveBeenCalled();
    });
  });

  describe("given a key budget the shared schema refuses", () => {
    const creates = {
      authorizeVirtualKeyCreate: async () => {},
      parseVirtualKeyBudget: (input: unknown) => virtualKeyBudgetInputSchema.safeParse(input),
    };

    /** @scenario A malformed cap is refused with the shared validation */
    it("answers 422 naming limit_usd, minting nothing", async () => {
      const createVirtualKey = vi.fn();
      const call = mount({ ...creates, createVirtualKey });
      const garbled = await call("POST", "/virtual-keys", {
        body: { name: "k", budget: { limit_usd: "10abs", window: "month" } },
      });
      const unwritable = await call("POST", "/virtual-keys", {
        body: { name: "k", budget: { limit_usd: 1e-7, window: "month" } },
      });

      for (const answer of [garbled, unwritable]) {
        expect([answer.status, answer.body.code]).toEqual([422, "validation_error"]);
        expect(answer.body.meta?.target).toBe("json");
        expect(JSON.stringify(answer.body.meta)).toContain("limit_usd");
      }
      expect(createVirtualKey).not.toHaveBeenCalled();
    });
  });

  describe("given a key spend read", () => {
    const visibleKey = {
      getVirtualKeyForCaller: async () => virtualKeyRow(),
      getVirtualKeySpend: async () => ({ spentUsd: "0", requests: 0 }),
    };

    /** @scenario The spend read validates its window */
    it("answers the framework's 422 validation_error when from is not before to", async () => {
      const getVirtualKeySpend = vi.fn();
      const answer = await mount({ ...visibleKey, getVirtualKeySpend })(
        "GET",
        "/virtual-keys/vk_1/spend?from=1760000000000&to=1750000000000",
      );

      expect([answer.status, answer.body.code]).toEqual([422, "validation_error"]);
      expect(JSON.stringify(answer.body.meta)).toContain("from");
      expect(getVirtualKeySpend).not.toHaveBeenCalled();
    });

    /** @scenario The spend window is epoch milliseconds, like every spend endpoint */
    it("echoes an epoch window and refuses the ISO form with 422", async () => {
      const call = mount(visibleKey);
      const epoch = await call(
        "GET",
        "/virtual-keys/vk_1/spend?from=1750000000000&to=1760000000000",
      );
      const iso = await call("GET", "/virtual-keys/vk_1/spend?from=2026-01-01T00:00:00Z");

      expect(epoch.status).toBe(200);
      expect(epoch.body.window).toEqual({ from: 1750000000000, to: 1760000000000 });
      expect([iso.status, iso.body.code]).toEqual([422, "validation_error"]);
    });

    /** @scenario A fresh key reports zero spend for the current month */
    it("answers 412 spend_source_unavailable rather than a zero it cannot vouch for", async () => {
      const answer = await mount({
        ...visibleKey,
        getVirtualKeySpend: async () => {
          throw new GatewaySpendSourceUnavailableError();
        },
      })("GET", "/virtual-keys/vk_1/spend");

      expect([answer.status, answer.body.code]).toEqual([412, "spend_source_unavailable"]);
    });
  });

  describe("given a cache rule the organization does not hold", () => {
    it("answers 404 rather than an internal failure", async () => {
      const answer = await mount({
        getCacheRule: async () => {
          throw new GatewayCacheRuleNotFoundError();
        },
      })("GET", "/cache-rules/cr_missing");

      expect([answer.status, answer.body.code]).toEqual([404, "gateway_cache_rule_not_found"]);
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

  describe("given a cycle anchor on a budget", () => {
    const anchored = (window: string) => ({
      scope: { kind: "project", project_id: PROJECT_ID },
      name: "b",
      window,
      limit_usd: "1",
      cycle_anchor_at: "2026-06-17T09:00:00.000Z",
    });

    /** @scenario A cycle anchor is rejected on windows that do not cycle */
    it("answers 400 gateway_budget_cycle_anchor_invalid echoing the window, creating nothing", async () => {
      for (const window of ["manual", "total"]) {
        const groupMemberCounts = vi.fn();
        const answer = await mount({
          createBudget: async () => {
            throw new GatewayBudgetCycleAnchorInvalidError(window);
          },
          groupMemberCounts,
        })("POST", "/budgets", { body: anchored(window) });

        expect([answer.status, answer.body.code]).toEqual([
          400,
          "gateway_budget_cycle_anchor_invalid",
        ]);
        expect(answer.body.message).toBe(
          "That window does not cycle, so it cannot take a cycle anchor",
        );
        expect(answer.body.meta?.window).toBe(window);
        expect(groupMemberCounts).not.toHaveBeenCalled();
      }
    });

    it("hands the anchor to the create as an instant and never to a patch", async () => {
      const createBudget = vi.fn().mockRejectedValue(new Error("stop after the input"));
      const updateBudget = vi.fn().mockRejectedValue(new Error("stop after the input"));
      const call = mount({ createBudget, updateBudget });

      await call("POST", "/budgets", { body: anchored("month") });
      await call("PATCH", "/budgets/bgt_1", {
        body: { name: "renamed", cycle_anchor_at: "2026-01-01T00:00:00.000Z" },
      });

      expect(createBudget.mock.calls[0]?.[0].cycleAnchorAt.toString()).toBe("2026-06-17T09:00:00Z");
      expect(updateBudget.mock.calls[0]?.[0]).not.toHaveProperty("cycleAnchorAt");
    });
  });
});
