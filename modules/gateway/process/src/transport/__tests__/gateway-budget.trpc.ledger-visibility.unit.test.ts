/**
 * @vitest-environment node
 * What a budget's detail shows each caller, off the real control plane.
 * @see modules/gateway/specs/gateway-budget-service.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { type AuthzApi, permissionsConferred } from "@langwatch/authz-contract";
import type { GatewayBudget, GatewayBudgetDebitRow } from "@langwatch/gateway-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { nowInstant, Temporal } from "@langwatch/time";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { memoryVirtualKeySeed } from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { GatewayModule } from "../../app/gateway.app.ts";
import { MemoryGatewayChannels } from "../../channels/memory/memory.gateway.channels.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import {
  MemoryGatewayStore,
  memoryGatewayDecimal,
} from "../../repositories/memory/memory.gateway.store.ts";
import { gatewayBudgetTrpcTransport } from "../gateway-budget.trpc.ts";

type GatewayTrpcTestContext = { actor: { id: string } };

const ORG_ID = "org_1";
const TENANT_PROJECT_ID = "project_1";
const BUDGET_ID = "bdg_1";

/** Each caller's organization role; the permission answers come from the real role templates. */
const ROLES = {
  usr_owner: "MEMBER",
  usr_admin: "ADMIN",
  usr_member: "MEMBER",
  usr_viewer: "VIEWER",
} as const;
type Caller = keyof typeof ROLES;

/** Every key the ledger names, and who made or holds it. */
const KEYS = {
  vk_shared: { principalUserId: null, createdById: "usr_admin" },
  vk_personal: { principalUserId: "usr_owner", createdById: "usr_owner" },
  vk_orphaned: { principalUserId: null, createdById: "usr_erased" },
  vk_machine: { principalUserId: null, createdById: `svc_${TENANT_PROJECT_ID}` },
} as const;
type KeyId = keyof typeof KEYS | "vk_deleted";

function budgetScopedTo(scope: Pick<GatewayBudget, "scopeType" | "scopeId">): GatewayBudget {
  const now = nowInstant();
  return {
    id: BUDGET_ID,
    organizationId: ORG_ID,
    ...scope,
    name: "budget",
    description: null,
    window: "MONTH",
    onBreach: "BLOCK",
    limitUsd: memoryGatewayDecimal("100.00"),
    spentUsd: memoryGatewayDecimal("0.00"),
    timezone: null,
    providerKey: null,
    externalId: null,
    metadata: null,
    currentPeriodStartedAt: now.subtract({ hours: 2 }),
    resetsAt: now.add({ hours: 24 * 30 }),
    lastResetAt: null,
    cycleAnchorAt: null,
    archivedAt: null,
    createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    createdById: "usr_admin",
    managedByVirtualKeyId: null,
  };
}

const ORGANIZATION_BUDGET = budgetScopedTo({ scopeType: "ORGANIZATION", scopeId: ORG_ID });

/** `count` debits through one key, the first `minutesAgo` minutes old and each a minute older. */
function debitsThrough({
  key,
  count = 1,
  minutesAgo = 0,
}: {
  key: KeyId;
  count?: number;
  minutesAgo?: number;
}): GatewayBudgetDebitRow[] {
  return Array.from({ length: count }, (_, index) => ({
    tenantId: TENANT_PROJECT_ID,
    budgetId: BUDGET_ID,
    scope: "ORGANIZATION",
    scopeId: ORG_ID,
    window: "MONTH",
    virtualKeyId: key,
    gatewayRequestId: `req_${key}_${index}`,
    amountNanoUsd: 1_000_000_000,
    tokensInput: 0,
    tokensOutput: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    model: "gpt-5",
    status: "SUCCESS",
    occurredAt: nowInstant().subtract({ minutes: minutesAgo + index }),
  }));
}

async function seededRepositories({
  budget,
  debits,
}: {
  budget: GatewayBudget;
  debits: readonly GatewayBudgetDebitRow[];
}) {
  const store = MemoryGatewayStore.create();
  store.budgets.set(BUDGET_ID, budget);
  const { repositories } = new MemoryGatewayRepositories(store);
  for (const [id, owner] of Object.entries(KEYS)) {
    await repositories.virtualKeys.create({
      ...memoryVirtualKeySeed({ id, name: id, organizationId: ORG_ID }),
      ...owner,
    });
  }
  for (const debit of debits) await repositories.budgetSpend.insertDebit([debit]);
  return repositories;
}

const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

const sorted = (ids: readonly string[]) => ids.toSorted((left, right) => left.localeCompare(right));

/** Boots the control plane over the seeded budget for one caller; `usr_erased` has no account. */
async function gatewayFor({
  caller,
  budget = ORGANIZATION_BUDGET,
  debits = [],
  lookupOutage,
}: {
  caller: Caller;
  budget?: GatewayBudget;
  debits?: readonly GatewayBudgetDebitRow[];
  lookupOutage?: Error;
}) {
  const asked: string[] = [];
  const channels = MemoryGatewayChannels.create();
  channels.users.erase({ userId: "usr_erased" });
  if (lookupOutage) channels.users.failWith({ error: lookupOutage });
  const app = await GatewayModule.create({
    channels,
    dependencies: {
      authz: createApiFixture<AuthzApi>({
        hasPermission: async ({ userId, permission }: { userId: string; permission: string }) => {
          asked.push(permission);
          const role = ROLES[userId as Caller];
          return permissionsConferred({
            role,
            scopeType: "ORGANIZATION",
            customPermissions: [],
          }).includes(permission);
        },
      }),
      projects: createApiFixture<ProjectApi>({
        listIdsByOrganization: async () => [TENANT_PROJECT_ID],
        listNamesByIds: async () => [],
        listTraceDestinations: async () => [],
      }),
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture<OrganizationApi>({
        findProvisioningSummary: async (organizationId) => ({
          id: organizationId,
          name: "Organization",
          slug: "organization",
          createdAt: nowInstant(),
        }),
      }),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: createApiFixture({}),
      apiKeys: createApiFixture({}),
      licensing: createApiFixture({}),
    },
    repositories: await seededRepositories({ budget, debits }),
    config: {
      foldCacheTtlSeconds: 300,
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      publicBaseUrl: void 0,
      baseUrl: undefined,
      publicUrl: undefined,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
  const trpc = initTRPC.context<GatewayTrpcTestContext>().create();
  const router = createTrpcRuntime<GatewayTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<GatewayTrpcTestContext>(),
  }).mount(gatewayBudgetTrpcTransport, () => app);
  const procedures = router.createCaller({ actor: { id: caller } });

  return {
    open: (id = BUDGET_ID) => procedures.get({ id, organizationId: ORG_ID }),
    rename: (id = BUDGET_ID) => procedures.update({ id, organizationId: ORG_ID, name: "renamed" }),
    archive: (id = BUDGET_ID) => procedures.archive({ id, organizationId: ORG_ID }),
    asked,
    lookedUp: () => sorted(channels.users.asked),
  };
}

/** The keys of the rows a caller sees on the seeded budget's detail. */
async function detailFor(input: {
  caller: Caller;
  keys: readonly KeyId[];
  budget?: GatewayBudget;
}) {
  const gateway = await gatewayFor({
    ...input,
    debits: input.keys.flatMap((key) => debitsThrough({ key })),
  });
  const detail = await gateway.open();

  return {
    shown: sorted(detail.recentLedger.map((row) => row.virtualKeyId)),
    asked: gateway.asked,
    lookedUp: gateway.lookedUp(),
  };
}

/** How a read was refused, so a refusal can be compared with an unknown id's. */
async function refusalOf(read: Promise<unknown>): Promise<unknown> {
  try {
    await read;
    return null;
  } catch (error) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return { code, message };
  }
}

describe("gatewayBudgets.get, the recent ledger of a budget", () => {
  describe("given a row through a shared key and one through a member's personal key", () => {
    const keys = ["vk_shared", "vk_personal"] as const;

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows the key's owner both rows", async () => {
      const { shown } = await detailFor({ caller: "usr_owner", keys });

      expect(shown).toEqual(["vk_personal", "vk_shared"]);
    });

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows an organization admin both rows, without looking up any creator's account", async () => {
      const { shown, asked, lookedUp } = await detailFor({ caller: "usr_admin", keys });

      expect(shown).toEqual(["vk_personal", "vk_shared"]);
      expect(asked).toEqual(["virtualKeys:viewOtherPersonal"]);
      expect(lookedUp).toEqual([]);
    });

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows another member only the shared key's row", async () => {
      const { shown } = await detailFor({ caller: "usr_member", keys });

      expect(shown).toEqual(["vk_shared"]);
    });

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows a viewer only the shared key's row", async () => {
      const { shown } = await detailFor({ caller: "usr_viewer", keys });

      expect(shown).toEqual(["vk_shared"]);
    });
  });

  describe("given a row through a key whose record is gone", () => {
    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows it only to those allowed to see other members' personal keys", async () => {
      const keys = ["vk_shared", "vk_deleted"] as const;

      expect((await detailFor({ caller: "usr_member", keys })).shown).toEqual(["vk_shared"]);
      expect((await detailFor({ caller: "usr_admin", keys })).shown).toEqual([
        "vk_deleted",
        "vk_shared",
      ]);
    });
  });

  describe("given the newest rows all ran through another member's personal key", () => {
    const debits = [
      ...debitsThrough({ key: "vk_personal", count: 25 }),
      ...debitsThrough({ key: "vk_shared", count: 3, minutesAgo: 30 }),
    ];

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("shows a member the older shared rows instead of an empty list", async () => {
      const { recentLedger } = await (await gatewayFor({ caller: "usr_member", debits })).open();

      expect(recentLedger.map((row) => row.id)).toEqual([
        "req_vk_shared_0",
        "req_vk_shared_1",
        "req_vk_shared_2",
      ]);
    });

    /** @scenario "Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys" */
    it("still lists no more than the newest 20 rows to a caller who sees them all", async () => {
      const { recentLedger } = await (await gatewayFor({ caller: "usr_admin", debits })).open();

      expect(recentLedger).toHaveLength(20);
      expect(recentLedger.every((row) => row.virtualKeyId === "vk_personal")).toBe(true);
    });
  });

  describe("given a row through a key with no principal whose creator's account is gone", () => {
    const keys = ["vk_shared", "vk_orphaned"] as const;

    /** @scenario "A key with no owner whose creator's account is gone counts as personal on a budget's detail" */
    it("hides it from a member", async () => {
      const { shown, lookedUp } = await detailFor({ caller: "usr_member", keys });

      expect(shown).toEqual(["vk_shared"]);
      expect(lookedUp).toEqual(["usr_admin", "usr_erased"]);
    });

    /** @scenario "A key with no owner whose creator's account is gone counts as personal on a budget's detail" */
    it("still shows it to an organization admin", async () => {
      const { shown } = await detailFor({ caller: "usr_admin", keys });

      expect(shown).toEqual(["vk_orphaned", "vk_shared"]);
    });
  });

  describe("given the account lookup for a key's creator fails", () => {
    /** @scenario "A key with no owner whose creator's account is gone counts as personal on a budget's detail" */
    it("fails the read rather than counting the account as gone", async () => {
      const outage = new Error("the user module did not answer");
      const gateway = await gatewayFor({
        caller: "usr_member",
        debits: debitsThrough({ key: "vk_orphaned" }),
        lookupOutage: outage,
      });

      const refused = await refusalOf(gateway.open());

      expect(refused).not.toBeNull();
      expect(refused).not.toEqual(await refusalOf(gateway.open("bdg_unknown")));
      expect(gateway.lookedUp()).toEqual(["usr_erased"]);
    });
  });

  describe("given a row through a key a project credential created", () => {
    /** @scenario "A key a machine created never counts as personal on a budget's detail" */
    it("shows it to a member without looking up an account for its creator", async () => {
      const { shown, lookedUp } = await detailFor({ caller: "usr_member", keys: ["vk_machine"] });

      expect(shown).toEqual(["vk_machine"]);
      expect(lookedUp).toEqual([]);
    });
  });
});

describe("gatewayBudgets get, update and archive, a budget scoped to one person", () => {
  const personalBudgets = [
    ["one member", budgetScopedTo({ scopeType: "PRINCIPAL", scopeId: "usr_owner" })],
    ["a personal key", budgetScopedTo({ scopeType: "VIRTUAL_KEY", scopeId: "vk_personal" })],
  ] as const;

  for (const [label, budget] of personalBudgets) {
    describe(`given a budget scoped to ${label}`, () => {
      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("opens for its owner", async () => {
        const opened = await (await gatewayFor({ caller: "usr_owner", budget })).open();

        expect(opened.id).toBe(BUDGET_ID);
      });

      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("opens for an organization admin", async () => {
        const opened = await (await gatewayFor({ caller: "usr_admin", budget })).open();

        expect(opened.id).toBe(BUDGET_ID);
      });

      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("answers a viewer exactly as for a budget that does not exist", async () => {
        const gateway = await gatewayFor({ caller: "usr_viewer", budget });

        const refused = await refusalOf(gateway.open());

        expect(refused).not.toBeNull();
        expect(refused).toEqual(await refusalOf(gateway.open("bdg_unknown")));
      });

      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("answers a viewer's edit and archive exactly as for a budget that does not exist", async () => {
        const gateway = await gatewayFor({ caller: "usr_viewer", budget });

        const renamed = await refusalOf(gateway.rename());
        const archived = await refusalOf(gateway.archive());

        expect(renamed).not.toBeNull();
        expect(renamed).toEqual(await refusalOf(gateway.rename("bdg_unknown")));
        expect(archived).toEqual(await refusalOf(gateway.archive("bdg_unknown")));
      });

      /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
      it("lets its owner edit and archive it", async () => {
        const gateway = await gatewayFor({ caller: "usr_owner", budget });

        expect(await gateway.rename()).toMatchObject({ id: BUDGET_ID, name: "renamed" });
        expect((await gateway.archive()).archivedAt).not.toBeNull();
      });
    });
  }

  describe("given a budget scoped to a shared key", () => {
    /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
    it("opens for a viewer", async () => {
      const budget = budgetScopedTo({ scopeType: "VIRTUAL_KEY", scopeId: "vk_shared" });
      const opened = await (await gatewayFor({ caller: "usr_viewer", budget })).open();

      expect(opened.id).toBe(BUDGET_ID);
    });
  });

  describe("given a budget capping each end user of a shared key", () => {
    /** @scenario "A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys" */
    it("opens for a viewer, since a key's end users are not members", async () => {
      const budget = budgetScopedTo({ scopeType: "ATTRIBUTED_USER", scopeId: "vk_shared" });
      const opened = await (await gatewayFor({ caller: "usr_viewer", budget })).open();

      expect(opened.id).toBe(BUDGET_ID);
    });
  });
});
