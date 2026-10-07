/**
 * @vitest-environment node
 * The Upgrades pages' six reads over the real runtime and a real `OpsModule`: the door asks
 * `ops:view` on the platform, and an operator gets the reader's answers unchanged.
 * Spec: modules/ops/specs/upgrades.feature
 */
import {
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcProcedureFactory,
  type TrpcRouterMount,
} from "@langwatch/api/trpc";
import type { OpsOperator } from "@langwatch/ops-contract";
import type { UpgradeReader, UpgradeRunDetail, UpgradeStepDetail } from "@langwatch/upgrade/reader";
import { describe, expect, it, vi } from "vitest";

import { createOpsTestApp, OPS_STAFF_ADDRESS } from "../../app/__tests__/ops.fixture.ts";
import { MemoryOpsRepositories } from "../../repositories/memory/memory.ops.repositories.ts";
import { MemoryUpgradeLedgerRepository } from "../../repositories/memory/memory.upgrade-ledger.repository.ts";
import { statusOf, stepOf } from "../../services/__tests__/support/upgrade-ledger.ts";
import { opsUpgradeTrpcTransport } from "../ops-upgrade.trpc.ts";
import { opsTrpcMembers, type OpsTrpcTestContext } from "./ops.trpc.harness.ts";

const OPERATOR: OpsOperator = { id: "user_alex", email: OPS_STAFF_ADDRESS };
const OUTSIDER: OpsOperator = { id: "user_sam", email: "sam@acme.com" };

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
  };
}

function mount({ reader }: { reader?: UpgradeReader } = {}) {
  const holders = { [OPERATOR.id]: ["ops:view"] } as const;
  const repositories = {
    ...MemoryOpsRepositories.create({ eventing: { definitions: [] } }),
    upgradeLedger: MemoryUpgradeLedgerRepository.create(reader ? { reader } : {}),
  };
  const { app } = createOpsTestApp({ repositories });
  const root = TrpcRootDefinition.forContext<OpsTrpcTestContext>().create();
  const router = createTrpcRuntime<OpsTrpcTestContext>({
    root,
    procedure: root.procedure,
    members: opsTrpcMembers({ holders }),
  }).mount(opsUpgradeTrpcTransport, () => app);

  return {
    operator: router.createCaller({ actor: { id: OPERATOR.id }, operator: OPERATOR }),
    outsider: router.createCaller({ actor: { id: OUTSIDER.id }, operator: OUTSIDER }),
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
  it("declares each of the six reads behind ops:view at the platform scope", () => {
    expect(boundAccess()).toEqual({
      "ops.upgrade.status": "permission-platform:ops:view",
      "ops.upgrade.listReleases": "permission-platform:ops:view",
      "ops.upgrade.listSteps": "permission-platform:ops:view",
      "ops.upgrade.getStep": "permission-platform:ops:view",
      "ops.upgrade.listRuns": "permission-platform:ops:view",
      "ops.upgrade.getRun": "permission-platform:ops:view",
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

      expect(await operator.status()).toEqual(await reader.status());
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
