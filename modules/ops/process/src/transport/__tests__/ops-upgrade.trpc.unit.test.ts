/**
 * @vitest-environment node
 * The Upgrades pages' six reads over the real runtime and a real `OpsModule`: the door asks
 * `ops:view` on the platform, and an operator gets the reader's answers unchanged.
 * Spec: modules/ops/specs/upgrades.feature
 */
import {
  bindTrpcFact,
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcProcedureFactory,
  type TrpcRouterMount,
} from "@langwatch/api/trpc";
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { OpsOperator } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UpgradeReader, UpgradeRunDetail, UpgradeStepDetail } from "@langwatch/upgrade/reader";
import { describe, expect, it, vi } from "vitest";

import { createOpsTestApp, OPS_STAFF_ADDRESS } from "../../app/__tests__/ops.fixture.ts";
import { SystemMigrationsService } from "../../features/system-migrations/services/system-migrations.service.ts";
import { MemoryOpsRepositories } from "../../repositories/memory/memory.ops.repositories.ts";
import { MemoryUpgradeLedgerRepository } from "../../repositories/memory/memory.upgrade-ledger.repository.ts";
import type { SystemMigrationsServiceDependencies } from "../../rules/system-migration-support.rules.ts";
import { statusOf, stepOf } from "../../services/__tests__/support/upgrade-ledger.ts";
import { opsOperatorFact } from "../ops-operator.trpc.ts";
import { opsUpgradeTrpcTransport } from "../ops-upgrade.trpc.ts";
import { opsTrpcMembers, type OpsTrpcTestContext } from "./ops.trpc.harness.ts";

const OPERATOR: OpsOperator = { id: "user_alex", email: OPS_STAFF_ADDRESS };
const OUTSIDER: OpsOperator = { id: "user_sam", email: "sam@acme.com" };
const MANAGER: OpsOperator = { id: "user_kim", email: OPS_STAFF_ADDRESS };

const STEP = stepOf({ id: "prisma:20261006_add_owner", release: "3.23.0" });
const STEP_DETAIL: UpgradeStepDetail = {
  ...STEP,
  targets: [
    { target: "postgres", status: "done", version: "3.23.0", lastError: null, updatedAt: null },
  ],
};
const RUN_SUMMARY = {
  id: "run_1",
  kind: "upgrade",
  release: "3.23.0",
  floor: "3.20.1",
  startedAt: "2026-10-06T10:00:00.000Z",
  finishedAt: "2026-10-06T10:01:00.000Z",
  outcome: "succeeded",
};
const RUN: UpgradeRunDetail = {
  ...RUN_SUMMARY,
  plan: { releases: ["3.23.0"] },
  report: null,
  phases: [
    {
      name: "preflight",
      release: null,
      startedAt: "2026-10-06T10:00:00.000Z",
      finishedAt: "2026-10-06T10:00:01.000Z",
      outcome: "succeeded",
    },
  ],
  steps: [STEP],
};

/** A ledger holding one release, one step and one run, as UpgradeReader answers it. */
function readerOfOneRelease(): UpgradeReader {
  return {
    status: vi.fn(async () => statusOf({ installed: "3.23.0", image: "3.23.0" })),
    listReleases: vi.fn(async () => ({
      items: [
        { release: "3.23.0", installed: true, image: true, stepCount: 1, counts: { done: 1 } },
      ],
      cursor: null,
    })),
    listSteps: vi.fn(async () => ({ items: [STEP], cursor: null })),
    getStep: vi.fn(async () => STEP_DETAIL),
    listRuns: vi.fn(async () => ({ items: [RUN_SUMMARY], cursor: null })),
    getRun: vi.fn(async () => RUN),
    preflight: vi.fn(async () => []),
    preview: vi.fn(async () => ({
      installed: "3.23.0",
      plan: { outcome: "planned" as const, fresh: false, releases: [], notNeeded: [] },
      preflight: [],
    })),
    listTargets: vi.fn(async () => []),
  };
}

const MIGRATION_PROCEDURE_NAMES = [
  "listSystemMigrations",
  "listMigrationEnrollments",
  "searchMigrationOrganizations",
  "enrollMigrationTenant",
  "enrollMigrationCohort",
  "withdrawMigrationTenant",
  "runSystemMigrationForOrganization",
  "runSystemMigrationPass",
  "assertSystemMigrationLegacyWritersDrained",
  "rollBackSystemMigrationTenant",
].map((name) => `ops.upgrade.${name}`);

function mount({
  reader,
  ledger,
}: { reader?: UpgradeReader; ledger?: MemoryUpgradeLedgerRepository } = {}) {
  const holders = {
    [OPERATOR.id]: ["ops:view"],
    [MANAGER.id]: ["ops:view", "ops:manage"],
  } as const;
  const repositories = {
    ...MemoryOpsRepositories.create({
      eventing: { definitions: [] },
      processStore: InMemoryProcessStore.createForTesting(),
    }),
    upgradeLedger: ledger ?? MemoryUpgradeLedgerRepository.create(reader ? { reader } : {}),
  };
  const { app } = createOpsTestApp({
    repositories,
    members: {
      createSystemMigrations: () =>
        SystemMigrationsService.create(
          createApiFixture<SystemMigrationsServiceDependencies>({
            state: repositories.migrationState,
          }),
        ),
    },
  });
  const root = TrpcRootDefinition.forContext<OpsTrpcTestContext>().create();
  const router = createTrpcRuntime<OpsTrpcTestContext>({
    root,
    procedure: root.procedure,
    members: opsTrpcMembers({ holders }),
  }).mount(opsUpgradeTrpcTransport, () => app, {
    facts: [bindTrpcFact(opsOperatorFact, (ctx: OpsTrpcTestContext) => ctx.operator)],
  });

  return {
    repositories,
    operator: router.createCaller({ actor: { id: OPERATOR.id }, operator: OPERATOR }),
    outsider: router.createCaller({ actor: { id: OUTSIDER.id }, operator: OUTSIDER }),
    manager: router.createCaller({ actor: { id: MANAGER.id }, operator: MANAGER }),
  };
}

/** Every procedure the declaration binds, with the access it asked for. */
function boundAccess(): Record<string, string> {
  const declared: Record<string, string> = {};
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access }) => {
      declared[procedure] =
        access.kind === "permission-platform" ? `${access.kind}:${access.permission}` : access.kind;
      return {};
    },
    router: (record) => record,
  };
  (opsUpgradeTrpcTransport as { router: TrpcRouterMount<never, never> }).router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });
  return declared;
}

describe("the ops.upgrade reads", () => {
  /** @scenario "Every upgrade read asks the operator view grant at the door" */
  it("declares each of the nine reads behind ops:view at the platform scope", () => {
    const reads = Object.fromEntries(
      Object.entries(boundAccess()).filter(
        ([name]) => !MIGRATION_PROCEDURE_NAMES.includes(name) && name !== "ops.upgrade.retryStep",
      ),
    );

    expect(reads).toEqual({
      "ops.upgrade.status": "permission-platform:ops:view",
      "ops.upgrade.listReleases": "permission-platform:ops:view",
      "ops.upgrade.listSteps": "permission-platform:ops:view",
      "ops.upgrade.getStep": "permission-platform:ops:view",
      "ops.upgrade.listRuns": "permission-platform:ops:view",
      "ops.upgrade.getRun": "permission-platform:ops:view",
      "ops.upgrade.preview": "permission-platform:ops:view",
      "ops.upgrade.listTargets": "permission-platform:ops:view",
      "ops.upgrade.listTenants": "permission-platform:ops:view",
    });
  });

  describe("given a signed-in user who is not a platform operator", () => {
    /** @scenario "A non-operator calling an upgrade read is refused by the door" */
    it("refuses ops.upgrade.status before the reader is asked", async () => {
      const reader = readerOfOneRelease();
      const { outsider } = mount({ reader });

      await expect(outsider.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(reader.status).not.toHaveBeenCalled();
    });
  });

  describe("given an operator and a ledger with a release, a step and a run", () => {
    /** @scenario "Upgrade reads answer the reader's shapes unchanged" */
    it("answers each read exactly as UpgradeReader answers it", async () => {
      const reader = readerOfOneRelease();
      const { operator } = mount({ reader });

      expect(await operator.status()).toEqual({ ...(await reader.status()), deprecations: [] });
      expect(await operator.listReleases()).toEqual(await reader.listReleases());
      expect(await operator.listSteps({ release: "3.23.0" })).toEqual(
        await reader.listSteps({ release: "3.23.0" }),
      );
      expect(await operator.getStep({ id: STEP.id })).toEqual(STEP_DETAIL);
      expect(await operator.listRuns({ limit: 20 })).toEqual(await reader.listRuns({ limit: 20 }));
      expect(await operator.getRun({ id: RUN.id })).toEqual(RUN);
      expect(reader.listSteps).toHaveBeenCalledWith({ release: "3.23.0" });
      expect(reader.getRun).toHaveBeenCalledWith({ id: RUN.id });
    });
  });

  describe("given an operator and a ledger that holds no such step or run", () => {
    /** @scenario "Opening a step or a run the ledger does not hold says it was not found" */
    it("answers upgrade_not_found for the step and for the run", async () => {
      const { operator } = mount();

      await expect(operator.getStep({ id: "prisma:missing" })).rejects.toMatchObject({
        cause: { code: "upgrade_not_found" },
      });
      await expect(operator.getRun({ id: "run_missing" })).rejects.toMatchObject({
        cause: { code: "upgrade_not_found" },
      });
    });
  });
});

const FAILED_STEP: UpgradeStepDetail = {
  ...STEP_DETAIL,
  id: "ops:backfill-owner",
  mode: "background",
  status: "failed",
  statusLabel: "Failed",
  lastError: "connection reset",
  runId: "run_1",
  report: { resumeFrom: "org_63" },
};

function ledgerHolding(step: UpgradeStepDetail): MemoryUpgradeLedgerRepository {
  return MemoryUpgradeLedgerRepository.create({
    reader: { ...readerOfOneRelease(), getStep: vi.fn(async () => step) },
  });
}

describe("ops.upgrade.retryStep", () => {
  describe("given a background step that failed", () => {
    /** @scenario "Retry without ops:manage is refused by the door" */
    it("refuses a view-only operator at the door and the step stays failed", async () => {
      const ledger = ledgerHolding(FAILED_STEP);
      const { operator } = mount({ ledger });

      expect(boundAccess()["ops.upgrade.retryStep"]).toBe("permission-platform:ops:manage");
      await expect(operator.retryStep({ id: FAILED_STEP.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect((await ledger.getStep({ id: FAILED_STEP.id })).status).toBe("failed");
    });

    /** @scenario "Retry sets a failed step pending and the worker runs it again" */
    it("records the step pending with its checkpoint kept", async () => {
      const ledger = ledgerHolding(FAILED_STEP);
      const { manager } = mount({ ledger });

      const answer = await manager.retryStep({ id: FAILED_STEP.id });

      expect(answer).toMatchObject({ status: "pending", report: FAILED_STEP.report });
      expect((await ledger.getStep({ id: FAILED_STEP.id })).status).toBe("pending");
    });

    it("lets one of two concurrent retries through and refuses the other as not failed", async () => {
      const { manager } = mount({ ledger: ledgerHolding(FAILED_STEP) });

      const answers = await Promise.allSettled([
        manager.retryStep({ id: FAILED_STEP.id }),
        manager.retryStep({ id: FAILED_STEP.id }),
      ]);

      expect(answers.filter((answer) => answer.status === "fulfilled")).toHaveLength(1);
      expect(answers.find((answer) => answer.status === "rejected")).toMatchObject({
        reason: { cause: { code: "upgrade_step_not_failed", meta: { status: "pending" } } },
      });
    });
  });

  describe("given a blocking schema step of either store that failed", () => {
    /** @scenario "A failed Postgres or ClickHouse schema step offers Retry on the Upgrades page" */
    it.each(["prisma:20261009_add_column", "clickhouse:00042"])(
      "records %s pending for the worker's next run",
      async (id) => {
        const step = { ...FAILED_STEP, id, mode: "blocking" as const };
        const ledger = ledgerHolding(step);
        const { manager } = mount({ ledger });

        await expect(manager.retryStep({ id })).resolves.toMatchObject({ status: "pending" });
      },
    );
  });

  describe("given a background step that is running", () => {
    /** @scenario "Retrying a step that is not failed is refused" */
    it("answers upgrade_step_not_failed naming the status and leaves the step running", async () => {
      const ledger = ledgerHolding({ ...FAILED_STEP, status: "running", lastError: null });
      const { manager } = mount({ ledger });

      await expect(manager.retryStep({ id: FAILED_STEP.id })).rejects.toMatchObject({
        cause: { code: "upgrade_step_not_failed", meta: { status: "running" } },
      });
      expect((await ledger.getStep({ id: FAILED_STEP.id })).status).toBe("running");
    });
  });

  describe("given no step with the id asked for", () => {
    /** @scenario "Retrying a step the ledger does not hold says it was not found" */
    it("answers upgrade_not_found", async () => {
      const { manager } = mount();

      await expect(manager.retryStep({ id: "ops:missing" })).rejects.toMatchObject({
        cause: { code: "upgrade_not_found" },
      });
    });
  });
});

describe("ops.upgrade.listTenants", () => {
  describe("given three parked tenants and one finalized in one step, one parked in another", () => {
    async function seeded() {
      const mounted = mount();
      const tenants = [
        { migrationName: "ops:first", tenantId: "org_a", status: "parked" },
        { migrationName: "ops:first", tenantId: "org_b", status: "parked" },
        { migrationName: "ops:first", tenantId: "org_c", status: "parked" },
        { migrationName: "ops:first", tenantId: "org_d", status: "finalized" },
        { migrationName: "ops:second", tenantId: "org_a", status: "parked" },
      ] as const;
      for (const tenant of tenants) {
        await mounted.repositories.migrationState.upsertRecord({ ...tenant, report: null });
      }
      return mounted;
    }

    /** @scenario "Tenant rows are listed by step and state, one page at a time" */
    it("pages the first step's parked tenants two at a time and ends with no cursor", async () => {
      const { operator } = await seeded();

      const first = await operator.listTenants({ step: "ops:first", state: "parked", limit: 2 });
      const last = await operator.listTenants({
        step: "ops:first",
        state: "parked",
        limit: 2,
        cursor: first.cursor,
      });

      expect(first.items).toHaveLength(2);
      expect(first.cursor).not.toBeNull();
      expect(last.items).toHaveLength(1);
      expect(last.cursor).toBeNull();
      expect([...first.items, ...last.items].map((row) => row.tenantId).toSorted()).toEqual([
        "org_a",
        "org_b",
        "org_c",
      ]);
    });

    /** @scenario "Tenant rows are listed by step and state, one page at a time" */
    it("lists every step's rows when no filter is named", async () => {
      const { operator } = await seeded();

      const page = await operator.listTenants({});

      expect(page.items).toHaveLength(5);
      expect(page.cursor).toBeNull();
    });

    /** @scenario "A non-operator asking for the tenant list is refused by the door" */
    it("refuses a user without ops:view", async () => {
      const { outsider } = await seeded();

      await expect(outsider.listTenants({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});

describe("given the installation upgrading", () => {
  /** @scenario "Every route serves while upgrading and still asks its declared permission" */
  it("still asks a declared procedure's permission at the door", async () => {
    const reader = readerOfOneRelease();
    const { outsider } = mount({ reader });

    await expect(outsider.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(reader.status).not.toHaveBeenCalled();
  });
});
