import { instantiateRepositories } from "@langwatch/process";
import { nowInstant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { GatewaySpendState } from "../../../eventing/gateway-spend.projection.ts";
import { EMPTY_SPEND_USAGE } from "../../../rules/gateway-spend-projection.rules.ts";
import { gatewayRepositories } from "../../gateway-repositories.registry.ts";
import { MemoryGatewayAuditRepository } from "../memory.gateway-audit.repository.ts";
import { MemoryGatewayBudgetSpendRepository } from "../memory.gateway-budget-spend.repository.ts";
import { MemoryGatewayCacheRuleRepository } from "../memory.gateway-cache-rule.repository.ts";
import { MemoryGatewayChangeEventsRepository } from "../memory.gateway-change-event.repository.ts";
import { MemoryGatewayGuardrailRepository } from "../memory.gateway-guardrail.repository.ts";
import { MemoryGatewayOpenAdmissionsRepository } from "../memory.gateway-open-admissions.repository.ts";
import { MemoryGatewayScopeResolutionRepository } from "../memory.gateway-scope-resolution.repository.ts";
import { MemoryGatewaySpendEventsRepository } from "../memory.gateway-spend-events.repository.ts";
import { MemoryGatewayVirtualKeyRepository } from "../memory.gateway-virtual-key.repository.ts";
import { MemoryGatewayRepositories } from "../memory.gateway.repositories.ts";
import { MemoryGatewayStore, memoryGatewayModelProvider } from "../memory.gateway.store.ts";
import { MemoryVirtualKeyAuthorizationRepository } from "../memory.virtual-key-authorization.repository.ts";

const ORG = "org_1";
const PROJECT = "project_1";

function keyInput(id: string, overrides: { externalId?: string; hashedSecret?: string } = {}) {
  return {
    id,
    organizationId: ORG,
    name: id,
    hashedSecret: overrides.hashedSecret ?? `hash_${id}`,
    displayPrefix: "lw_vk_",
    config: {},
    createdById: "usr_1",
    scopes: [{ scopeType: "TEAM" as const, scopeId: "team_1" }],
    ...(overrides.externalId === undefined ? {} : { externalId: overrides.externalId }),
  };
}

function spendState(overrides: Partial<GatewaySpendState> = {}): GatewaySpendState {
  return {
    status: "confirmed",
    organizationId: ORG,
    virtualKeyId: "vk_1",
    principalUserId: "",
    endUserId: "end_1",
    model: "gpt-5-mini",
    providerKey: "mp_1",
    traceId: "",
    requestType: "chat",
    labels: [],
    metadataJson: '{"tier":"gold"}',
    podId: "",
    podSeq: 0,
    usage: { ...EMPTY_SPEND_USAGE, input_tokens: 10, output_tokens: 5 },
    rateVersion: "",
    costNanoUsd: 1_500_000_000,
    errorType: "",
    httpStatus: 200,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs: Temporal.Instant.from("2026-10-01T10:00:00Z").epochMilliseconds,
    durationMs: 10,
    createdAt: 1,
    updatedAt: 1,
    LastEventOccurredAt: 0,
    ...overrides,
  };
}

describe("memory gateway twins", () => {
  describe("given a virtual key written through the key twin", () => {
    it("answers it by its secret, and by its previous secret only within the grace", async () => {
      const keys = MemoryGatewayVirtualKeyRepository.create(MemoryGatewayStore.create());
      await keys.create(keyInput("vk_1"));
      await keys.rotateSecret({
        id: "vk_1",
        organizationId: ORG,
        newHashedSecret: "hash_new",
        newDisplayPrefix: "lw_vk_n",
        previousHashedSecret: "hash_vk_1",
        previousSecretValidUntil: nowInstant().add({ hours: 1 }),
      });

      expect((await keys.findByHashedSecret("hash_new"))?.revision).toBe(2n);
      expect((await keys.findByHashedSecret("hash_vk_1"))?.id).toBe("vk_1");

      await keys.revoke({ id: "vk_1", organizationId: ORG, revokedById: "usr_1" });
      expect(await keys.findByHashedSecret("hash_vk_1")).toBeNull();
    });

    it("refuses a second key holding the same external id in the organization", async () => {
      const keys = MemoryGatewayVirtualKeyRepository.create(MemoryGatewayStore.create());
      await keys.create(keyInput("vk_1", { externalId: "ext" }));

      await expect(keys.create(keyInput("vk_2", { externalId: "ext" }))).rejects.toMatchObject({
        code: "P2002",
        meta: { target: ["organizationId", "externalId"] },
      });
    });

    it("pages the organization's customer keys newest first after the cursor", async () => {
      const keys = MemoryGatewayVirtualKeyRepository.create(MemoryGatewayStore.create());
      for (const id of ["vk_a", "vk_b", "vk_c"]) await keys.create(keyInput(id));
      const [first] = await keys.findPageInOrganization({
        organizationId: ORG,
        limit: 1,
        cursor: null,
      });

      const rest = await keys.findPageInOrganization({
        organizationId: ORG,
        limit: 5,
        cursor: { createdAt: first!.createdAt, id: first!.id },
      });

      expect([first!.id, ...rest.map((key) => key.id)]).toEqual([
        ...new Set([first!.id, ...rest.map((key) => key.id)]),
      ]);
      expect(rest).toHaveLength(2);
    });

    it("records a CONNECT key's services and licence, and reads the key back by its licence", async () => {
      const store = MemoryGatewayStore.create();
      const keys = MemoryGatewayVirtualKeyRepository.create(store);
      await keys.create({ ...keyInput("vk_c"), purpose: "CONNECT" });
      await keys.create(keyInput("vk_u"));

      expect(
        await keys.setConnectServices({
          id: "vk_c",
          organizationId: ORG,
          services: ["managed_models"],
        }),
      ).toBe(true);
      expect(
        await keys.setConnectServices({
          id: "vk_u",
          organizationId: ORG,
          services: ["managed_models"],
        }),
      ).toBe(false);
      await keys.setLicenseFacts({
        id: "vk_c",
        organizationId: ORG,
        tokenHash: "license_hash",
        instanceId: "inst_1",
        expiresAt: null,
      });

      const licensed = await keys.findByLicenseTokenHash("license_hash");
      expect(licensed).toMatchObject({ instanceId: "inst_1", services: ["managed_models"] });
      expect(licensed?.key.revision).toBe(3n);
      expect(
        await MemoryGatewayScopeResolutionRepository.create(store).findManagedKeyConnectServices({
          virtualKeyId: "vk_c",
          organizationId: ORG,
        }),
      ).toEqual(["managed_models"]);
    });
  });

  it("reaches only enabled providers scoped to one of the key's scopes", async () => {
    const store = MemoryGatewayStore.create({
      modelProviders: [
        memoryGatewayModelProvider({
          id: "mp_org",
          name: "Org",
          provider: "openai",
          organizationId: ORG,
        }),
        memoryGatewayModelProvider({
          id: "mp_team",
          name: "Team",
          provider: "anthropic",
          organizationId: ORG,
          scopes: [{ scopeType: "TEAM", scopeId: "team_1" }],
        }),
        memoryGatewayModelProvider({
          id: "mp_off",
          name: "Off",
          provider: "openai",
          organizationId: ORG,
          enabled: false,
        }),
      ],
    });

    const reached = await MemoryGatewayScopeResolutionRepository.create(
      store,
    ).findProvidersReachableFromScopes({
      organizationIds: [],
      teamIds: ["team_1"],
      projectIds: [],
    });

    expect(reached.map((provider) => provider.id)).toEqual(["mp_team"]);
  });

  it("authorizes against the organization's own teams, projects and guardrails", async () => {
    const store = MemoryGatewayStore.create({
      teams: [
        { id: "team_1", organizationId: ORG, name: "One", slug: "one" },
        { id: "team_x", organizationId: "org_2", name: "X", slug: "x" },
      ],
      projects: [{ id: PROJECT, teamId: "team_1" }],
    });
    const guardrail = await MemoryGatewayGuardrailRepository.create(store).create({
      projectId: PROJECT,
      name: "PII",
      evaluatorId: "ev_1",
      direction: "PRE",
      actorUserId: "usr_1",
    });
    const authorization = MemoryVirtualKeyAuthorizationRepository.create(store);

    expect(
      await authorization.findTeamIdsInOrganization({
        organizationId: ORG,
        teamIds: ["team_1", "team_x"],
      }),
    ).toEqual(["team_1"]);
    expect(await authorization.findProjectIdsForTeams({ teamIds: ["team_1"] })).toEqual([PROJECT]);
    expect(
      await authorization.findGuardrailIdsInProject({
        projectId: "project_other",
        guardrailIds: [guardrail.id],
      }),
    ).toEqual([]);
  });

  it("lists guardrails in the direction enum's order and drops archived ones", async () => {
    const store = MemoryGatewayStore.create({ evaluators: [{ id: "ev_1", slug: "pii-check" }] });
    const guardrails = MemoryGatewayGuardrailRepository.create(store);
    const post = await guardrails.create({
      projectId: PROJECT,
      name: "a",
      evaluatorId: "ev_1",
      direction: "POST",
      actorUserId: "usr_1",
    });
    const pre = await guardrails.create({
      projectId: PROJECT,
      name: "b",
      evaluatorId: "ev_1",
      direction: "PRE",
      actorUserId: "usr_1",
    });

    expect((await guardrails.findBundleEntries(PROJECT)).map((entry) => entry.id)).toEqual([
      pre.id,
      post.id,
    ]);
    expect((await guardrails.findBundleEntries(PROJECT))[0]).toMatchObject({
      evaluatorSlug: "pii-check",
      direction: "pre",
      failureMode: "fail_closed",
    });

    await guardrails.archive({ id: pre.id, projectId: PROJECT, actorUserId: "usr_1" });
    expect((await guardrails.findAll(PROJECT)).map((row) => row.id)).toEqual([post.id]);
  });

  it("writes a cache rule with its change event and audit row, and pages by priority", async () => {
    const changes = MemoryGatewayChangeEventsRepository.create();
    const audit = MemoryGatewayAuditRepository.create();
    const rules = MemoryGatewayCacheRuleRepository.create({
      store: MemoryGatewayStore.create(),
      changes,
      audit,
    });
    const low = await rules.create({
      organizationId: ORG,
      name: "low",
      priority: 10,
      matchers: { model: "gpt-5" },
      action: { mode: "force", ttl: 60 },
      actorUserId: "usr_1",
    });
    const high = await rules.create({
      organizationId: ORG,
      name: "high",
      priority: 900,
      matchers: {},
      action: { mode: "disable" },
      actorUserId: "usr_1",
    });

    const [first] = await rules.findPage({ organizationId: ORG, limit: 1, cursor: null });
    expect(first?.id).toBe(high.id);
    expect(
      await rules.findPage({
        organizationId: ORG,
        limit: 5,
        cursor: {
          priority: high.priority,
          createdAt: Temporal.Instant.fromEpochMilliseconds(high.createdAt.getTime()),
          id: high.id,
        },
      }),
    ).toEqual([low]);
    expect(low.mode).toBe("FORCE");
    expect((await changes.since(ORG, 0n)).events.map((event) => event.kind)).toEqual([
      "CACHE_RULE_CREATED",
      "CACHE_RULE_CREATED",
    ]);
    expect(audit.entries().map((entry) => entry.action)).toEqual([
      "gateway.cache_rule.created",
      "gateway.cache_rule.created",
    ]);
  });

  describe("given debits in the budget ledger twin", () => {
    const debit = (overrides: { gatewayRequestId: string; amountNanoUsd: number; at: string }) => ({
      tenantId: PROJECT,
      budgetId: "budget_1",
      scope: "PROJECT" as const,
      scopeId: PROJECT,
      window: "MONTH" as const,
      virtualKeyId: "vk_1",
      tokensInput: 1,
      tokensOutput: 1,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model: "gpt-5",
      status: "SUCCESS" as const,
      gatewayRequestId: overrides.gatewayRequestId,
      amountNanoUsd: overrides.amountNanoUsd,
      occurredAt: Temporal.Instant.from(overrides.at),
    });
    const target = {
      budgetId: "budget_1",
      scope: "PROJECT" as const,
      scopeId: PROJECT,
      window: "MONTH" as const,
    };
    const now = Temporal.Instant.from("2026-10-20T00:00:00Z");

    it("sums the current calendar period once per request, skipping a replay", async () => {
      const ledger = MemoryGatewayBudgetSpendRepository.create();
      await ledger.insertDebit([
        debit({ gatewayRequestId: "r1", amountNanoUsd: 1_000, at: "2026-10-02T00:00:00Z" }),
      ]);
      await ledger.insertDebit([
        debit({ gatewayRequestId: "r1", amountNanoUsd: 9_999, at: "2026-10-02T00:00:00Z" }),
      ]);
      await ledger.insertDebit([
        debit({ gatewayRequestId: "r2", amountNanoUsd: 500, at: "2026-09-30T23:59:00Z" }),
      ]);

      expect(await ledger.findSpendForTargetsAcrossTenants([PROJECT], [target], now)).toEqual([
        {
          budgetId: "budget_1",
          scope: "PROJECT",
          scopeId: PROJECT,
          spentNanoUsd: 1_000,
          spentUsd: "0.000001",
        },
      ]);
    });

    it("sums from a moved floor when the target names one", async () => {
      const ledger = MemoryGatewayBudgetSpendRepository.create();
      await ledger.insertDebit([
        debit({ gatewayRequestId: "r1", amountNanoUsd: 1_000, at: "2026-10-02T00:00:00Z" }),
      ]);
      await ledger.insertDebit([
        debit({ gatewayRequestId: "r2", amountNanoUsd: 2_000, at: "2026-10-10T00:00:00Z" }),
      ]);

      const [spend] = await ledger.findSpendForTargetsAcrossTenants(
        [PROJECT],
        [
          {
            ...target,
            periodFloorMs: Temporal.Instant.from("2026-10-05T00:00:00Z").epochMilliseconds,
          },
        ],
        now,
      );

      expect(spend?.spentNanoUsd).toBe(2_000);
    });
  });

  describe("given requests folded into the spend record twin", () => {
    it("reads a request back for the fold and groups charged spend by model", async () => {
      const spendEvents = MemoryGatewaySpendEventsRepository.create();
      await spendEvents.upsertFromFold([
        { tenantId: PROJECT, gatewayRequestId: "r1", state: spendState() },
        { tenantId: PROJECT, gatewayRequestId: "r2", state: spendState({ model: "claude" }) },
        { tenantId: PROJECT, gatewayRequestId: "r3", state: spendState({ status: "admitted" }) },
      ]);

      expect(
        (await spendEvents.findForFold({ tenantId: PROJECT, gatewayRequestId: "r1" }))?.costNanoUsd,
      ).toBe(1_500_000_000);
      const { rows } = await spendEvents.readSpendSummaries({
        tenantIds: [PROJECT],
        groupBy: ["model"],
        fromMs: 0,
        toMs: Number.MAX_SAFE_INTEGER,
        filters: { metadata: [{ key: "tier", values: ["gold"] }] },
      });

      expect(rows.map((row) => [row.key, row.eventCount, row.costUsd])).toEqual([
        ["claude", 1, "1.5"],
        ["gpt-5-mini", 1, "1.5"],
      ]);
    });

    it("lets the sweep find a request still admitted past its grace", async () => {
      const spendEvents = MemoryGatewaySpendEventsRepository.create();
      const admittedAt = Temporal.Instant.from("2026-10-01T10:00:00Z").epochMilliseconds;
      await spendEvents.upsertFromFold([
        { tenantId: PROJECT, gatewayRequestId: "r1", state: spendState({ status: "" }) },
        { tenantId: PROJECT, gatewayRequestId: "r2", state: spendState() },
      ]);

      const open = await MemoryGatewayOpenAdmissionsRepository.create(
        spendEvents,
      ).findOpenAdmissions({
        now: admittedAt + 60_000,
        graceMs: 30_000,
        lookbackMs: 3_600_000,
      });

      expect(open.map((admission) => admission.gatewayRequestId)).toEqual(["r1"]);
    });
  });

  describe("given a budget written through the memory tier", () => {
    it("blocks a request that would cross it and warns as it nears it", async () => {
      const store = MemoryGatewayStore.create({
        teams: [{ id: "team_1", organizationId: ORG, name: "One", slug: "one" }],
      });
      const repositories = new MemoryGatewayRepositories(store).repositories;
      const budget = await repositories.budgets.create({
        organizationId: ORG,
        scope: { kind: "PROJECT", projectId: PROJECT },
        name: "Project cap",
        window: "MONTH",
        limitUsd: "1",
        actorUserId: "usr_1",
      });
      await repositories.budgetSpend.insertDebit([
        {
          tenantId: PROJECT,
          budgetId: budget.id,
          scope: "PROJECT",
          scopeId: PROJECT,
          window: "MONTH",
          virtualKeyId: "vk_1",
          gatewayRequestId: "r1",
          amountNanoUsd: 850_000_000,
          tokensInput: 1,
          tokensOutput: 1,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model: "gpt-5",
          status: "SUCCESS",
          occurredAt: nowInstant(),
        },
      ]);
      const check = (projectedCostUsd: number) =>
        repositories.budgets.check({
          organizationId: ORG,
          teamId: null,
          projectId: PROJECT,
          virtualKeyId: "vk_1",
          projectedCostUsd,
          tenantIds: [PROJECT],
          memberGroupIds: [],
        });

      expect(await check(0)).toMatchObject({
        decision: "soft_warn",
        warnings: [{ scope: "project", pctUsed: 85, limitUsd: "1" }],
      });
      expect(await check(0.2)).toMatchObject({
        decision: "hard_block",
        blockedBy: [{ budgetId: budget.id, spentUsd: "0.850000", limitUsd: "1" }],
      });
      expect(
        (await repositories.budgets.findAll({ organizationId: ORG, tenantIds: [PROJECT] }))[0]
          ?.spentNanoUsd,
      ).toBe(850_000_000);
    });
  });

  it("boots the memory tier from the registry with no store", async () => {
    const repositories = instantiateRepositories(gatewayRepositories, {
      tier: "memory",
      members: {},
    });

    const key = await repositories.virtualKeys.create(keyInput("vk_1"));

    expect(await repositories.virtualKeys.findById({ id: key.id, organizationId: ORG })).toEqual(
      key,
    );
    expect(
      await repositories.spendScope.findVirtualKeyIdsForExternalIds({
        organizationId: ORG,
        externalIds: [],
      }),
    ).toEqual([]);
  });
});
