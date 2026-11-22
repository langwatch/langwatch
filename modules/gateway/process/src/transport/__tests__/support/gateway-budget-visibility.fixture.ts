/**
 * The real control plane over memory twins, booted for one caller around one seeded budget, for
 * the suites on what a budget's detail shows and who may open it.
 */
import {
  createTrpcErrorFormatter,
  createTrpcRuntime,
  trpcFailureTraceIds,
} from "@langwatch/api/trpc";
import { type AuthzApi, permissionsConferred } from "@langwatch/authz-contract";
import type { GatewayBudget, GatewayBudgetDebitRow } from "@langwatch/gateway-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { nowInstant, Temporal } from "@langwatch/time";
import { getTRPCErrorFromUnknown, getTRPCErrorShape, initTRPC } from "@trpc/server";

import { memoryVirtualKeySeed } from "../../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { MemoryGatewayChannels } from "../../../channels/memory/memory.gateway.channels.ts";
import { MemoryGatewayRepositories } from "../../../repositories/memory/memory.gateway.repositories.ts";
import {
  MemoryGatewayStore,
  memoryGatewayDecimal,
} from "../../../repositories/memory/memory.gateway.store.ts";
import { gatewayBudgetTrpcTransport } from "../../gateway-budget.trpc.ts";
import { memoryGatewayApp } from "./gateway-memory-app.fixture.ts";

type GatewayTrpcTestContext = { actor: { id: string } };

const ORG_ID = "org_1";
const TENANT_PROJECT_ID = "project_1";
export const BUDGET_ID = "bdg_1";

/** What a refusal carries when the caller is told the budget does not exist. */
export const BUDGET_NOT_FOUND = { data: { error: { code: "budget_not_found" } } } as const;

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

/** Answers each permission from the caller's role template, noting every permission asked. */
function authzByRole({ asked }: { asked: string[] }) {
  return createApiFixture<AuthzApi>({
    hasPermission: async ({ userId, permission }: { userId: string; permission: string }) => {
      asked.push(permission);
      const role = ROLES[userId as Caller];
      return permissionsConferred({
        role,
        scopeType: "ORGANIZATION",
        customPermissions: [],
      }).includes(permission);
    },
  });
}

const sorted = (ids: readonly string[]) => ids.toSorted((left, right) => left.localeCompare(right));

/** The control plane over the seeded budget; `usr_erased` has no account. */
async function seededGateway({
  budget,
  debits,
  lookupOutage,
  asked,
}: {
  budget: GatewayBudget;
  debits: readonly GatewayBudgetDebitRow[];
  lookupOutage: Error | undefined;
  asked: string[];
}) {
  const channels = MemoryGatewayChannels.create();
  channels.users.erase({ userId: "usr_erased" });
  if (lookupOutage) channels.users.failWith({ error: lookupOutage });
  const app = await memoryGatewayApp({
    channels,
    repositories: await seededRepositories({ budget, debits }),
    authz: authzByRole({ asked }),
    projects: createApiFixture<ProjectApi>({
      listIdsByOrganization: async () => [TENANT_PROJECT_ID],
      listNamesByIds: async () => [],
      listTraceDestinations: async () => [],
    }),
    organizations: createApiFixture<OrganizationApi>({
      findProvisioningSummary: async (organizationId) => ({
        id: organizationId,
        name: "Organization",
        slug: "organization",
        createdAt: nowInstant(),
      }),
    }),
  });
  return { app, channels };
}

/** Mounts the budget procedures over the seeded control plane for one caller. */
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
  const { app, channels } = await seededGateway({ budget, debits, lookupOutage, asked });
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

/** The api host's error formatter, so a refusal reads as the body a tRPC client receives. */
const clientWire = initTRPC.create({
  errorFormatter: createTrpcErrorFormatter({
    causePayload: { payloadFor: () => null },
    traceIds: trpcFailureTraceIds,
  }),
});

/** These name the request, not the answer, so two equal answers still differ in them. */
const REQUEST_IDS: ReadonlySet<string> = new Set(["traceId", "spanId", "traceUrl", "logsUrl"]);

function withoutRequestIds(value: object | null | undefined): Record<string, unknown> | null {
  if (value == null) return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !REQUEST_IDS.has(key)));
}

/**
 * The whole body a tRPC client receives for a refused read, so a refusal can be compared with an
 * unknown id's: tRPC code, status, wire message, handled error and cause. Null when it succeeds.
 */
export async function refusalOf(read: Promise<unknown>): Promise<unknown> {
  try {
    await read;
    return null;
  } catch (thrown) {
    const { data, ...wire } = getTRPCErrorShape({
      config: clientWire._config,
      error: getTRPCErrorFromUnknown(thrown),
      type: "unknown",
      path: undefined,
      input: undefined,
      ctx: undefined,
    });

    return { ...wire, data: { ...withoutRequestIds(data), error: withoutRequestIds(data.error) } };
  }
}
