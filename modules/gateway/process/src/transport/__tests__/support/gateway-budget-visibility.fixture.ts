/**
 * The real control plane over memory twins, booted for one caller around one seeded budget, for
 * the suites on what a budget's detail shows and who may open it.
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

import { memoryVirtualKeySeed } from "../../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { GatewayModule } from "../../../app/gateway.app.ts";
import { MemoryGatewayChannels } from "../../../channels/memory/memory.gateway.channels.ts";
import { MemoryGatewayRepositories } from "../../../repositories/memory/memory.gateway.repositories.ts";
import {
  MemoryGatewayStore,
  memoryGatewayDecimal,
} from "../../../repositories/memory/memory.gateway.store.ts";
import { gatewayBudgetTrpcTransport } from "../../gateway-budget.trpc.ts";

type GatewayTrpcTestContext = { actor: { id: string } };

const ORG_ID = "org_1";
const TENANT_PROJECT_ID = "project_1";
export const BUDGET_ID = "bdg_1";

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
export type KeyId = keyof typeof KEYS | "vk_deleted";

export function budgetScopedTo(scope: Pick<GatewayBudget, "scopeType" | "scopeId">): GatewayBudget {
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
export function debitsThrough({
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
export async function gatewayFor({
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
export async function detailFor(input: {
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

/** The code a read was refused with, so a refusal can be compared with an unknown id's. */
export async function refusalOf(read: Promise<unknown>): Promise<unknown> {
  try {
    await read;
    return null;
  } catch (error) {
    return { code: (error as { code?: unknown }).code };
  }
}
