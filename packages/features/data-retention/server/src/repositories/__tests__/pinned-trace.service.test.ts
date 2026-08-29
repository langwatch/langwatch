import { describe, expect, it } from "vitest";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { DataRetentionRepository } from "../data-retention.repository";
import { PinnedTraceRepository } from "../pinned-trace.repository";
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

const create = (pinRepository: Pins) =>
  DataRetentionService.create({
    repository,
    projects,
    organizations,
    defaultRetentionDays: 49,
    pinRepository,
  });

describe("DataRetentionService pin lifecycle", () => {
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
