import { DatasetNotReadyError } from "@langwatch/dataset-contract";
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

  /** @scenario "An owner's refusal by name releases the reservation so a rerun retries the item" */
  it("releases the reservation of a dataset the owner refused, and the rerun copies it once", async () => {
    const grant = ["project:create", "evaluations:create", "datasets:create"];
    const execute = (current: StaffAccessCopyPlan) =>
      run.execute({
        plan: current,
        requestId: "staffrequest_1",
        source: ACME,
        target: GLOBEX,
        grant,
        stillLive: async () => null,
      });
    catalog.hooks.beforeDatasetCopy = async () => {
      throw new DatasetNotReadyError({ status: "processing" });
    };

    const first = await execute(plan);
    catalog.hooks.beforeDatasetCopy = async () => {};
    const rerun = await execute(
      await run.plan({ source: ACME, target: GLOBEX, projects: [sourceProjectId] }),
    );

    expect(first.items.find((item) => item.kind === "dataset")).toMatchObject({
      outcome: "failed",
      reason: "dataset_not_ready",
    });
    expect(rerun.items.find((item) => item.kind === "dataset")).toMatchObject({
      outcome: "copied",
    });
    expect(catalog.data.datasets.filter((d) => d.projectId !== sourceProjectId)).toHaveLength(1);
  });

  const fullGrant = [
    "project:create",
    "evaluations:create",
    "prompts:create",
    "prompts:update",
    "datasets:create",
  ];
  const executeAll = (current: StaffAccessCopyPlan) =>
    run.execute({
      plan: current,
      requestId: "staffrequest_1",
      source: ACME,
      target: GLOBEX,
      grant: fullGrant,
      stillLive: async () => null,
    });

  /** @scenario "A copy of every project carries only live application projects" */
  it("plans only the live application project when every project is copied", async () => {
    catalog.addProject({ organizationId: ACME.id, name: "rollup", kind: "aggregate" });
    catalog.addProject({ organizationId: ACME.id, name: "olivia-sandbox", isPersonal: true });
    catalog.addProject({
      organizationId: ACME.id,
      name: "retired",
      archivedAt: new Date(AT.epochMilliseconds),
    });

    const everything = await run.plan({ source: ACME, target: GLOBEX, projects: undefined });

    expect(
      everything.items.filter((item) => item.kind === "project").map((item) => item.name),
    ).toEqual(["support-bot"]);
  });

  /** @scenario "A copied project joins the target's existing shared team" */
  it("creates the project in the target's shared team without making a new one", async () => {
    catalog.data.teams.push({ id: "team_globex_shared", organizationId: GLOBEX.id });

    await executeAll(plan);

    const made = catalog.data.projects.filter((project) => project.organizationId === GLOBEX.id);
    expect(made.map((project) => project.teamId)).toEqual(["team_globex_shared"]);
    expect(catalog.data.teams.filter((team) => team.organizationId === GLOBEX.id)).toEqual([
      { id: "team_globex_shared", organizationId: GLOBEX.id },
    ]);
  });

  /** @scenario "A monitor whose evaluator was not copied is skipped" */
  it("skips a monitor whose evaluator the copy did not make", async () => {
    const studio = catalog.addEvaluator({
      projectId: sourceProjectId,
      name: "Studio judge",
      type: "workflow",
    });
    catalog.addMonitor({
      projectId: sourceProjectId,
      name: "Judged replies",
      evaluatorId: studio.id,
    });

    const { items } = await executeAll(
      await run.plan({ source: ACME, target: GLOBEX, projects: [sourceProjectId] }),
    );

    expect(items.find((item) => item.kind === "monitor")).toMatchObject({
      outcome: "skipped",
      reason: "evaluator_not_copied",
    });
    expect(catalog.data.monitors.some((monitor) => monitor.projectId !== sourceProjectId)).toBe(
      false,
    );
  });
});
