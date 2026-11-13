import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { copyCatalog, type CopyCatalog } from "../../app/__tests__/support/copy-catalog.ts";
import { MemoryStaffAccessCopyLedgerRepository } from "../../repositories/memory/memory.staff-access-copy-ledger.repository.ts";
import {
  StaffAccessCopyRunService,
  type StaffAccessCopyPlan,
} from "../staff-access-copy-run.service.ts";

const AT = Temporal.Instant.from("2026-11-13T09:00:00Z");
const ACME = { id: "org_acme", slug: "acme", name: "ACME", createdAt: AT };
const GLOBEX = { id: "org_globex", slug: "globex", name: "Globex", createdAt: AT };

describe("StaffAccessCopyRunService.execute", () => {
  let catalog: CopyCatalog;
  let run: StaffAccessCopyRunService;
  let plan: StaffAccessCopyPlan;
  let sourceProjectId: string;

  beforeEach(async () => {
    catalog = copyCatalog();
    run = StaffAccessCopyRunService.create({
      ledger: MemoryStaffAccessCopyLedgerRepository.create(),
      organizations: catalog.organizations as never,
      projects: catalog.projects as never,
      evaluators: catalog.evaluators,
      monitors: catalog.monitors,
      prompts: catalog.prompts,
      datasets: catalog.datasets,
      now: () => AT,
    });
    const project = catalog.addProject({ organizationId: ACME.id, name: "support-bot" });
    catalog.addEvaluator({ projectId: project.id, name: "Exact match" });
    catalog.addDataset({ projectId: project.id, name: "Golden answers" });
    sourceProjectId = project.id;
    plan = await run.plan({ source: ACME, target: GLOBEX, projects: [project.id] });
  });

  /** @scenario "A copy makes only what the target approval granted" */
  it("skips every item the target grant does not cover and makes the rest", async () => {
    const { items } = await run.execute({
      plan,
      requestId: "staffrequest_1",
      source: ACME,
      target: GLOBEX,
      grant: ["project:create", "evaluations:create"],
      stillLive: async () => null,
    });

    expect(items.map((item) => [item.kind, item.outcome, item.reason])).toEqual([
      ["project", "copied", null],
      ["evaluator", "copied", null],
      ["dataset", "skipped", "outside_copy_grant"],
    ]);
    expect(catalog.data.datasets.map((dataset) => dataset.projectId)).toEqual([sourceProjectId]);
  });

  /** @scenario "A revoked approval stops a running copy" */
  it("marks every remaining item stopped once an approval is no longer live", async () => {
    const { items, stoppedBecause } = await run.execute({
      plan,
      requestId: "staffrequest_1",
      source: ACME,
      target: GLOBEX,
      grant: ["project:create", "evaluations:create", "datasets:create"],
      stillLive: async () => "target_approval_ended",
    });

    expect(stoppedBecause).toBe("target_approval_ended");
    expect(items.map((item) => item.outcome)).toEqual(["stopped", "stopped", "stopped"]);
    expect(catalog.data.projects.some((p) => p.organizationId === GLOBEX.id)).toBe(false);
  });
});
