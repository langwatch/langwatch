/**
 * @vitest-environment node
 *
 * A blocking budget must actually block, and must warn before it does.
 *
 * Real Postgres + real ClickHouse, no mocks. Spend is written by the real
 * debits process manager, exactly as its outbox executes it, and read back
 * through the real service, so this covers the whole control-plane path the
 * gateway enforces from: debit -> ledger -> rollup -> decision.
 *
 * Regression guard for issue #6141, where budgets accrued nothing on four of
 * six windows and so never warned and never blocked however much traffic ran.
 * A budget that silently never enforces is worse than no budget, so this fails
 * if the ladder from allow to warn to block ever stops working.
 */
import {
  runWriteGatewayDebits,
  type WriteGatewayDebitsPayload,
} from "@ee/governance/process-manager/gatewayDebits.process";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CURRENT_ROLLUP_REBUILD_MIGRATION,
  replayGooseMigrationUp,
} from "~/server/clickhouse/__tests__/migrationReplay";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { NANO_USD_PER_USD } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";

import { GatewayBudgetClickHouseRepository } from "../budget.clickhouse.repository";
import { GatewayBudgetService } from "../budget.service";

const suffix = nanoid(8);
const ORG_ID = `org-enf-${suffix}`;
const TEAM_ID = `team-enf-${suffix}`;
const PROJECT_ID = `proj-enf-${suffix}`;
const IDLE_PROJECT_ID = `proj-idle-${suffix}`;
const USER_ID = `usr-enf-${suffix}`;
const VK_ID = `vk_enf_${suffix}`;
const BUDGET_ID = `bdg-enf-${suffix}`;
const IDLE_BUDGET_ID = `bdg-idle-${suffix}`;
const PRE_PROJECT_ID = `proj-preutc-${suffix}`;
const PRE_VK_ID = `vk_preutc_${suffix}`;
const PRE_BUDGET_ID = `bdg-preutc-${suffix}`;

/** $0.001 per request against a $0.005 ceiling: 20% a request. */
const LIMIT_USD = "0.005";
const COST_PER_REQUEST = 0.001;

/** One served request's debit, as the spend pipeline mints it. */
function servedRequest(options: {
  projectId: string;
  virtualKeyId: string;
}): WriteGatewayDebitsPayload {
  return {
    gateway_request_id: `grq_${nanoid()}`,
    project_id: options.projectId,
    organization_id: ORG_ID,
    team_id: TEAM_ID,
    virtual_key_id: options.virtualKeyId,
    principal_user_id: USER_ID,
    end_user_id: "",
    model: "gpt-5-mini",
    model_provider_id: "",
    usage: {
      input_tokens: 300,
      output_tokens: 150,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_tokens: 0,
    },
    cost_nano_usd: COST_PER_REQUEST * NANO_USD_PER_USD,
    rate_version: "catalog@test",
    status: "confirmed",
    error_type: "",
    duration_ms: 120,
    occurred_at: Date.now(),
  };
}

describe("given a blocking budget on traffic the gateway is serving", () => {
  let service: GatewayBudgetService;
  let recordOneRequest: () => Promise<void>;
  let writeDebits: (payload: WriteGatewayDebitsPayload) => Promise<void>;

  const decide = async () =>
    await service.check({
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      virtualKeyId: VK_ID,
      principalUserId: USER_ID,
      projectedCostUsd: "0.000001",
    });

  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `Org ${suffix}`, slug: ORG_ID },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Team ${suffix}`,
        slug: TEAM_ID,
        organizationId: ORG_ID,
      },
    });
    for (const id of [PROJECT_ID, IDLE_PROJECT_ID]) {
      await prisma.project.create({
        data: {
          id,
          name: id,
          slug: id,
          teamId: TEAM_ID,
          language: "en",
          framework: "openai",
          apiKey: `key-${id}`,
        },
      });
    }
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@acme.test`, name: "ACME Admin" },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: "enforcement-key",
        hashedSecret: `hash-${suffix}`,
        displayPrefix: "vk-lw-xxxxxxx",
        principalUserId: USER_ID,
        createdById: USER_ID,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_ID,
        name: `enforced-${suffix}`,
        organizationId: ORG_ID,
        scopeType: "PROJECT",
        scopeId: PROJECT_ID,
        window: "DAY",
        limitUsd: LIMIT_USD,
        onBreach: "BLOCK",
        createdById: USER_ID,
        resetsAt: new Date(Date.now() + 86_400_000),
      },
    });
    // A budget pointed at a project no key sends traffic to.
    await prisma.gatewayBudget.create({
      data: {
        id: IDLE_BUDGET_ID,
        name: `unreachable-${suffix}`,
        organizationId: ORG_ID,
        scopeType: "PROJECT",
        scopeId: IDLE_PROJECT_ID,
        window: "DAY",
        limitUsd: LIMIT_USD,
        onBreach: "BLOCK",
        createdById: USER_ID,
        resetsAt: new Date(Date.now() + 86_400_000),
      },
    });

    const resolveClient = async (tenantId: string) => {
      const client = await getClickHouseClientForProject(tenantId);
      if (!client) throw new Error("no ClickHouse client in test environment");
      return client;
    };
    const chRepo = new GatewayBudgetClickHouseRepository(resolveClient);
    service = GatewayBudgetService.create(prisma, chRepo);

    writeDebits = runWriteGatewayDebits({
      prisma,
      budgetCHRepository: chRepo,
    });

    recordOneRequest = async () => {
      await writeDebits(
        servedRequest({ projectId: PROJECT_ID, virtualKeyId: VK_ID }),
      );
    };
  }, 120_000);

  afterAll(async () => {
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({
      where: { id: { in: [VK_ID, PRE_VK_ID] } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  }, 120_000);

  describe("when spend is still well under the limit", () => {
    it("lets the request through with no warning", async () => {
      await recordOneRequest();

      const decision = await decide();

      expect(decision.decision).toBe("allow");
      expect(decision.warnings).toHaveLength(0);
    });
  });

  describe("when spend has passed 80% of the limit but not the limit", () => {
    /** @scenario "A blocking budget warns before it blocks" */
    it("still lets the request through, and warns", async () => {
      // Three more requests: 4 x $0.001 against a $0.005 ceiling = 80%.
      await recordOneRequest();
      await recordOneRequest();
      await recordOneRequest();

      const decision = await decide();

      expect(decision.decision).toBe("soft_warn");
      expect(decision.warnings.length).toBeGreaterThan(0);
      expect(decision.warnings[0]!.scope).toBe("project");
      expect(decision.warnings[0]!.pctUsed).toBeGreaterThanOrEqual(80);
      expect(decision.blockedBy).toHaveLength(0);
    });
  });

  describe("when spend has passed the limit", () => {
    /** @scenario "A blocking budget blocks once its recorded spend passes the limit" */
    it("refuses the request and names the budget that was exceeded", async () => {
      // Two more takes it to $0.006 against the $0.005 ceiling.
      await recordOneRequest();
      await recordOneRequest();

      const decision = await decide();

      expect(decision.decision).toBe("hard_block");
      expect(decision.blockReason).toBeTruthy();
      expect(decision.blockedBy.map((b) => b.budgetId)).toContain(BUDGET_ID);
    });
  });

  describe("when a budget points at a project no key sends traffic to", () => {
    /** @scenario "A budget warns when no key can ever spend against it" */
    it("reports it as unreachable, and where the keys do send traffic", async () => {
      const { scopeReach } = await service.listWithHealth(ORG_ID);

      const idle = scopeReach.get(IDLE_BUDGET_ID);

      expect(idle?.reachable).toBe(false);
      // Naming where traffic does land is what makes the warning
      // actionable: without it the reader knows the budget is inert but
      // not what to re-scope it to.
      expect(idle?.reachableProjectIds).toContain(PROJECT_ID);
      expect(idle?.reachableProjectIds).not.toContain(IDLE_PROJECT_ID);
    });
  });

  describe("when a budget points at the project a key does send traffic to", () => {
    /** @scenario "A budget that some key can spend against carries no warning" */
    it("reports it as reachable", async () => {
      const { scopeReach } = await service.listWithHealth(ORG_ID);

      expect(scopeReach.get(BUDGET_ID)?.reachable).toBe(true);
    });
  });

  describe("when spend totals cannot be read", () => {
    /** @scenario "A budget whose spend cannot be totalled says so instead of showing zero" */
    it("reports spend as unavailable rather than as zero", async () => {
      const withoutLedger = GatewayBudgetService.create(prisma, undefined);

      const { budgets, spendAvailable } =
        await withoutLedger.listWithHealth(ORG_ID);

      expect(spendAvailable).toBe(false);
      // The budget is still listed, and the only spend figure left on it is
      // the Postgres column, which reads 0 even though $0.006 was really
      // spent above. Rendering that as "$0.00 spent, 0% of limit" is the
      // lie the flag exists to prevent.
      const budget = budgets.find((b) => b.id === BUDGET_ID);
      expect(budget).toBeDefined();
      expect(Number(budget!.spentUsd)).toBe(0);
    });
  });

  describe("given spend recorded before the UTC rollup rebuild", () => {
    // The upgrade path migration 00058 protects: a deployment whose
    // ClickHouse ran outside UTC folded its history at local midnight, a
    // bucket enforcement never reads. The migration rebuilds the rollup
    // from the ledger under UTC boundaries, so that history must count
    // toward warning and blocking together with spend recorded after it.
    //
    // $0.004 of the $0.005 ceiling is recorded pre-rebuild: enough that
    // two ordinary post-rebuild requests cross the cap, while the same
    // two requests alone would sit at 40% and sail through. Blocking
    // therefore proves the rebuilt history is enforced, not merely shown.
    const PRE_SPEND_USD = "0.0040000000";

    // Captured in beforeAll, while the schema is still on the 00055 view,
    // so the assertions below never depend on live schema mutations from
    // inside a test body.
    let preRebuildDecision: Awaited<ReturnType<GatewayBudgetService["check"]>>;

    const decidePreProject = async () =>
      await service.check({
        organizationId: ORG_ID,
        teamId: TEAM_ID,
        projectId: PRE_PROJECT_ID,
        virtualKeyId: PRE_VK_ID,
        principalUserId: USER_ID,
        projectedCostUsd: "0.000001",
      });

    const recordOnePreProjectRequest = async () => {
      await writeDebits(
        servedRequest({
          projectId: PRE_PROJECT_ID,
          virtualKeyId: PRE_VK_ID,
        }),
      );
    };

    beforeAll(async () => {
      await prisma.project.create({
        data: {
          id: PRE_PROJECT_ID,
          name: PRE_PROJECT_ID,
          slug: PRE_PROJECT_ID,
          teamId: TEAM_ID,
          language: "en",
          framework: "openai",
          apiKey: `key-${PRE_PROJECT_ID}`,
        },
      });
      await prisma.virtualKey.create({
        data: {
          id: PRE_VK_ID,
          organizationId: ORG_ID,
          name: "pre-rebuild-key",
          hashedSecret: `hash-pre-${suffix}`,
          displayPrefix: "vk-lw-yyyyyyy",
          principalUserId: USER_ID,
          createdById: USER_ID,
          scopes: {
            create: [{ scopeType: "PROJECT", scopeId: PRE_PROJECT_ID }],
          },
        },
      });
      await prisma.gatewayBudget.create({
        data: {
          id: PRE_BUDGET_ID,
          name: `pre-rebuild-${suffix}`,
          organizationId: ORG_ID,
          scopeType: "PROJECT",
          scopeId: PRE_PROJECT_ID,
          window: "DAY",
          limitUsd: LIMIT_USD,
          onBreach: "BLOCK",
          createdById: USER_ID,
          resetsAt: new Date(Date.now() + 86_400_000),
        },
      });

      const client = await getClickHouseClientForProject(PRE_PROJECT_ID);
      if (!client) throw new Error("no ClickHouse client in test environment");

      // Pre-rebuild state: the 00055 view truncates periods in the server
      // session timezone.
      await replayGooseMigrationUp({
        client,
        fileName: "00055_gateway_budget_scope_totals_period_start.sql",
      });

      // History folded by the old view as a Sao Paulo server would fold
      // it: a synchronous insert so the view's SELECT runs under this
      // session_timezone (an async insert is flushed with server defaults
      // and would defeat the simulation).
      const occurredAt = Date.now();
      await client.insert({
        table: "gateway_budget_ledger_events",
        values: [
          {
            TenantId: PRE_PROJECT_ID,
            BudgetId: PRE_BUDGET_ID,
            Scope: "project",
            ScopeId: PRE_PROJECT_ID,
            Window: "DAY",
            VirtualKeyId: PRE_VK_ID,
            ProviderCredentialId: "",
            GatewayRequestId: `grq_pre_${suffix}`,
            AmountUSD: PRE_SPEND_USD,
            TokensInput: 300,
            TokensOutput: 150,
            TokensCacheRead: 0,
            TokensCacheWrite: 0,
            Model: "gpt-5-mini",
            ProviderSlot: "",
            DurationMS: 120,
            Status: "success",
            OccurredAt: occurredAt,
            EventTimestamp: occurredAt,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: {
          session_timezone: "America/Sao_Paulo",
        },
      });

      // The decision as a pre-upgrade deployment would compute it, then
      // the upgrade under test: the CURRENT rollup rebuild, which pins the
      // truncation to UTC, keys the aggregate by budget, and re-derives
      // every row from the ledger. Replaying the newest rebuild rather than
      // the one that first fixed the timezone is what keeps this scenario
      // honest as the rollup evolves: the claim is that spend folded by any
      // older view still enforces after the upgrade a deployment runs.
      preRebuildDecision = await decidePreProject();
      await replayGooseMigrationUp({
        client,
        fileName: CURRENT_ROLLUP_REBUILD_MIGRATION,
      });
    }, 120_000);

    afterAll(async () => {
      // The replays above mutate shared database schema, not tenant data.
      // Re-apply the current migration unconditionally so a failure
      // anywhere in this describe can never leave later suites running
      // against the 00055 view. Idempotent by the migration's own design.
      const client = await getClickHouseClientForProject(PRE_PROJECT_ID);
      await replayGooseMigrationUp({
        client: client!,
        fileName: CURRENT_ROLLUP_REBUILD_MIGRATION,
      });
    }, 120_000);

    describe("when the rollup rebuild has not run", () => {
      /** @scenario "Spend recorded before the rollup rebuild still counts after it" */
      it("lets requests through as if nothing had been spent", () => {
        // The bug the rebuild exists for: $0.004 of $0.005 is spent, and
        // the decision neither warns nor blocks because the history sits
        // in a bucket the reader never asks about.
        expect(preRebuildDecision.decision).toBe("allow");
        expect(preRebuildDecision.warnings).toHaveLength(0);
      });
    });

    describe("when the rollup rebuild runs", () => {
      /** @scenario "Spend recorded before the rollup rebuild still counts after it" */
      it("counts the pre-rebuild spend and warns at 80% of the limit", async () => {
        const decision = await decidePreProject();

        expect(decision.decision).toBe("soft_warn");
        expect(decision.warnings.length).toBeGreaterThan(0);
        expect(decision.warnings[0]!.pctUsed).toBeGreaterThanOrEqual(80);
        expect(decision.blockedBy).toHaveLength(0);
      });
    });

    describe("when new spend joins the pre-rebuild spend", () => {
      /** @scenario "Spend recorded before the rollup rebuild still counts after it" */
      it("blocks once the two together pass the limit", async () => {
        // Two post-rebuild requests: $0.004 + 2 x $0.001 = $0.006 against
        // the $0.005 ceiling. Alone they are 40% of the limit, so this
        // block can only come from the rebuilt history.
        await recordOnePreProjectRequest();
        await recordOnePreProjectRequest();

        const decision = await decidePreProject();

        expect(decision.decision).toBe("hard_block");
        expect(decision.blockReason).toBeTruthy();
        expect(decision.blockedBy.map((b) => b.budgetId)).toContain(
          PRE_BUDGET_ID,
        );
      });
    });
  });
});
