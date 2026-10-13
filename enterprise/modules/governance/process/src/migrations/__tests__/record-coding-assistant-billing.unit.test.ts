// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: enterprise/modules/governance/specs/governance-deploy-steps.feature
 */
import { ASSISTANT_KINDS } from "@langwatch/enterprise-governance-contract";
import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryCostAttributionPolicyRepository } from "../../repositories/memory/memory.cost-attribution-policy.repository.ts";
import {
  bootGovernanceWorker,
  organizationIdPages,
  runStep,
} from "./governance-deploy-steps.fixture.ts";

const STEP_ID = "governance:record-coding-assistant-billing";
const ORGANIZATIONS = ["org_a", "org_b", "org_c"] as const;
const CODEX_OFF_BUNDLED_PLAN = { assistantKind: "codex", bundledPlan: false };

/** The memory twin the worker builds, holding configs an older image saved. */
function seedConfigs(seed: { organizationId: string; config: unknown }[]) {
  const seeded = MemoryCostAttributionPolicyRepository.create({ seed });
  vi.spyOn(MemoryCostAttributionPolicyRepository, "create").mockReturnValue(seeded);
}

async function bootOver({ refusePage }: { refusePage?: number } = {}) {
  const pages = organizationIdPages({ ids: ORGANIZATIONS, pageSize: 2, refusePage });
  const worker = await bootGovernanceWorker({ organization: pages.organization });
  return { ...worker, asked: pages.asked };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given a worker installing governance", () => {
  /** @scenario "The coding-assistant billing seed is a background step that waits for the old writers" */
  it("declares the billing seed as a background data step needing the old writers gone", async () => {
    const { runtime, step } = await bootOver();
    try {
      expect(step(STEP_ID)).toMatchObject({
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
      });
    } finally {
      await runtime.stop();
    }
  });

  describe("when the seed runs over three organisations", () => {
    /** @scenario "The coding-assistant billing seed pages organisations by cursor and saves each page" */
    it("reads organisation ids a page at a time and records each organisation's answers", async () => {
      seedConfigs([{ organizationId: "org_b", config: CODEX_OFF_BUNDLED_PLAN }]);
      const { runtime, step, billedFacts, asked } = await bootOver();
      try {
        const { report, saves } = await runStep({ step: step(STEP_ID) });

        expect(asked).toEqual([
          { limit: ORGANIZATION_ID_PAGE_LIMIT },
          { after: "org_b", limit: ORGANIZATION_ID_PAGE_LIMIT },
        ]);
        expect(saves).toEqual([{ afterOrganizationId: "org_b" }, { afterOrganizationId: "org_c" }]);
        expect(report).toMatchObject({ organizations: 3, recorded: 3 * ASSISTANT_KINDS.length });
        await expect(
          billedFacts({ organizationId: "org_b", sourceType: "codex" }),
        ).resolves.toEqual([true]);
        await expect(
          billedFacts({ organizationId: "org_a", sourceType: "claude_code" }),
        ).resolves.toEqual([false]);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "An organisation edited by an old pod is recorded once the old writers are gone" */
    it("records a codex config saved without a fact as billed", async () => {
      seedConfigs([{ organizationId: "org_c", config: CODEX_OFF_BUNDLED_PLAN }]);
      const { runtime, step, billedFacts } = await bootOver();
      try {
        await runStep({ step: step(STEP_ID) });

        await expect(
          billedFacts({ organizationId: "org_c", sourceType: "codex" }),
        ).resolves.toEqual([true]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the seed resumes from a saved page", () => {
    /** @scenario "The coding-assistant billing seed resumes after the last organisation it saved" */
    it("reads only organisations after the saved one", async () => {
      const { runtime, step, billedFacts, asked } = await bootOver();
      try {
        const { report } = await runStep({
          step: step(STEP_ID),
          resumeFrom: { afterOrganizationId: "org_b" },
        });

        expect(asked).toEqual([{ after: "org_b", limit: ORGANIZATION_ID_PAGE_LIMIT }]);
        expect(report).toMatchObject({ organizations: 1 });
        await expect(
          billedFacts({ organizationId: "org_a", sourceType: "codex" }),
        ).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the seed runs twice", () => {
    /** @scenario "Running the coding-assistant billing seed twice leaves the same answers" */
    it("states the same answer for each organisation on both runs", async () => {
      seedConfigs([{ organizationId: "org_a", config: CODEX_OFF_BUNDLED_PLAN }]);
      const { runtime, step, billedFacts } = await bootOver();
      try {
        await runStep({ step: step(STEP_ID) });
        await runStep({ step: step(STEP_ID) });

        await expect(
          billedFacts({ organizationId: "org_a", sourceType: "codex" }),
        ).resolves.toEqual([true, true]);
        await expect(
          billedFacts({ organizationId: "org_c", sourceType: "codex" }),
        ).resolves.toEqual([false, false]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the seed runs as a dry run", () => {
    /** @scenario "A dry run of the coding-assistant billing seed records nothing" */
    it("counts the organisations and records no fact", async () => {
      const { runtime, step, billedFacts } = await bootOver();
      try {
        const { report, saves } = await runStep({ step: step(STEP_ID), dryRun: true });

        expect(report).toMatchObject({ organizations: 3, recorded: 0, dryRun: true });
        expect(saves).toEqual([]);
        await expect(
          billedFacts({ organizationId: "org_a", sourceType: "codex" }),
        ).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the worker stops the seed mid-run", () => {
    /** @scenario "A stopped coding-assistant billing seed ends between organisations and keeps its checkpoint" */
    it("records no organisation after the abort and saves nothing", async () => {
      const { runtime, step, billedFacts } = await bootOver();
      const stop = new AbortController();
      stop.abort();
      try {
        const { report, saves } = await runStep({ step: step(STEP_ID), signal: stop.signal });

        expect(report).toMatchObject({ organizations: 0, recorded: 0 });
        expect(saves).toEqual([]);
        await expect(
          billedFacts({ organizationId: "org_a", sourceType: "codex" }),
        ).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when organization's id list refuses the second page", () => {
    /** @scenario "A failed page read fails the coding-assistant billing seed without saving past it" */
    it("fails with the refusal and keeps the first page's checkpoint", async () => {
      const { runtime, step } = await bootOver({ refusePage: 2 });
      const saves: Record<string, unknown>[] = [];
      try {
        const run = step(STEP_ID).run({
          checkpoint: { resumeFrom: null, save: async ({ report }) => void saves.push(report) },
          dryRun: false,
          signal: new AbortController().signal,
        });

        await expect(run).rejects.toMatchObject({ code: "ids_unavailable" });
        expect(saves).toEqual([{ afterOrganizationId: "org_b" }]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
