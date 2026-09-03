import { describe, expect, it } from "vitest";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { DataRetentionRepository } from "../data-retention.repository";
import { PinnedTraceRepository } from "../pinned-trace.repository";
import { RetroactiveRetentionRepository } from "../retroactive-retention.repository";
import { DataRetentionService } from "../../services/data-retention.service";

class Pins extends PinnedTraceRepository {
  private row: any = null;
  async tryFindByProjectAndTrace() {
    return this.row;
  }
  async findAllByProject() {
    return this.row ? [this.row] : [];
  }
  async findAllTraceIds() {
    return this.row ? [this.row.traceId] : [];
  }
  async create(input: any) {
    this.row = { id: "pin", createdAt: new Date(), userId: null, reason: null, ...input };
    return this.row;
  }
  async delete() {
    this.row = null;
  }
  async hasManualPin() {
    return this.row?.source === "manual";
  }
}

const repository = {
  findAllInOrganization: async () => [],
  tryFindById: async () => null,
  upsertForScope: async () => ({}) as any,
  deleteForScope: async () => {},
} as unknown as DataRetentionRepository;
const projects = {
  getWithTeam: async () => ({
    id: "project",
    teamId: "team",
    team: { organizationId: "org" },
  }),
} as unknown as ProjectService;
const organizations = {
  getTeamById: async () => ({ id: "team", organizationId: "org" }),
} as unknown as OrganizationService;

/**
 * The ClickHouse seam. Pinning is an annotation, so nothing on this port may be
 * reached by a pin — which is what the test below asserts rather than assumes.
 */
class RecordingRetroactive extends RetroactiveRetentionRepository {
  readonly calls: string[] = [];
  async triggerUpdate(): Promise<{ tables: string[] }> {
    this.calls.push("triggerUpdate");
    return { tables: [] };
  }
  async getMutationProgress(): Promise<never[]> {
    this.calls.push("getMutationProgress");
    return [];
  }
  async killMutation(): Promise<void> {
    this.calls.push("killMutation");
  }
}

const create = (pinRepository: Pins, retroactiveRepository?: RecordingRetroactive) =>
  DataRetentionService.create({
    repository,
    projects,
    organizations,
    defaultRetentionDays: 49,
    pinRepository,
    retroactiveRepository,
  });

describe("DataRetentionService pin lifecycle", () => {
  /** @scenario "Pinning a trace does not change retention" */
  it("records the pin and issues no ClickHouse retention command", async () => {
    const pins = new Pins();
    const retroactive = new RecordingRetroactive();
    const service = create(pins, retroactive);

    await service.pin({ projectId: "project", traceId: "trace" });

    await expect(
      service.isPinned({ projectId: "project", traceId: "trace" }),
    ).resolves.toBe(true);
    expect(retroactive.calls).toEqual([]);
  });

  /** @scenario "Manual pins survive share removal" */
  it("keeps a manual pin when auto-unpin runs", async () => {
    const service = create(new Pins());
    await service.autoPin({ projectId: "project", traceId: "trace" });
    await service.pin({ projectId: "project", traceId: "trace" });
    await service.autoUnpin({ projectId: "project", traceId: "trace" });
    await expect(
      service.isPinned({ projectId: "project", traceId: "trace" }),
    ).resolves.toBe(true);
  });
});
