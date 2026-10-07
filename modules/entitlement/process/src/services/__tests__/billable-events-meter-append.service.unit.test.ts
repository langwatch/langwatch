import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import type { BillableEventRecord } from "../../repositories/billable-events-meter.repository.ts";
import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import { BillableEventsMeterAppendService } from "../billable-events-meter-append.service.ts";

type ProjectLookup = Pick<ProjectApi, "findOrganizationId">;

/** Answers from a mutable map, so a project can join an organization mid-test. */
class ProjectDirectory implements ProjectLookup {
  readonly organizationOf = new Map<string, string>();

  async findOrganizationId(projectId: string): Promise<string | undefined> {
    return this.organizationOf.get(projectId);
  }
}

/** Records each warning as the pino call shape `(fields, message)`. */
class WarningLog {
  readonly lines: { fields: unknown; message: unknown }[] = [];

  warn(fields: unknown, message?: unknown): void {
    this.lines.push({ fields, message });
  }
}

function record(eventId: string): BillableEventRecord {
  return {
    organizationId: "",
    tenantId: "project_orphan",
    eventId,
    eventType: "lw.obs.trace.span_received",
    deduplicationKey: eventId,
    eventTimestamp: 1_772_539_200_000,
  };
}

function compose() {
  const meter = MemoryBillableEventsMeterRepository.create();
  const projects = new ProjectDirectory();
  const log = new WarningLog();
  const append = BillableEventsMeterAppendService.create({
    meter,
    projects,
    logger: log,
  });
  return { meter, projects, log, append };
}

describe("BillableEventsMeterAppendService", () => {
  describe("given a project that belongs to no organization", () => {
    describe("when a billable event arrives for it", () => {
      /** @scenario "A billable event from an orphan project is skipped, loudly" */
      it("writes no meter row and logs a warning naming the project", async () => {
        const { meter, log, append } = compose();

        await append.append(record("evt_1"));

        expect(meter.rows).toEqual([]);
        expect(log.lines).toEqual([
          { fields: { projectId: "project_orphan" }, message: expect.any(String) },
        ]);
      });
    });
  });

  describe("given a project whose organization could not be found a moment ago", () => {
    describe("when the project joins an organization and its next billable event arrives", () => {
      /** @scenario "A project's organization is not remembered as missing" */
      it("meters that event against the organization", async () => {
        const { meter, projects, append } = compose();
        await append.append(record("evt_1"));

        projects.organizationOf.set("project_orphan", "org_1");
        await append.append(record("evt_2"));

        expect(meter.rows).toEqual([
          expect.objectContaining({ eventId: "evt_2", organizationId: "org_1" }),
        ]);
      });
    });
  });
});
