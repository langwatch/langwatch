import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeLineageRepository } from "../../repositories/authz-read.repository";
import { AuthzScopeLineageService } from "../authz-scope-lineage.service";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn }),
}));

class TestScopeLineageRepository extends ScopeLineageRepository {
  readonly tryFindProjectLineage = vi.fn(
    async ({
      projectId,
    }: {
      projectId: string;
    }): Promise<{
      teamId: string;
      organizationId: string;
    } | null> => {
      const organizationId = this.projectOrganizations[projectId];
      return organizationId ? { teamId: `team-for-${projectId}`, organizationId } : null;
    },
  );

  readonly tryFindTeamOrganization = vi.fn(
    async ({ teamId }: { teamId: string }): Promise<{ organizationId: string } | null> => {
      const organizationId = this.teamOrganizations[teamId];
      return organizationId ? { organizationId } : null;
    },
  );

  constructor(
    private readonly projectOrganizations: Record<string, string | undefined>,
    private readonly teamOrganizations: Record<string, string | undefined>,
  ) {
    super();
  }
}

function createService({
  projectOrganizations = {},
  teamOrganizations = {},
}: {
  projectOrganizations?: Record<string, string | undefined>;
  teamOrganizations?: Record<string, string | undefined>;
} = {}) {
  const repository = new TestScopeLineageRepository(projectOrganizations, teamOrganizations);
  const service = AuthzScopeLineageService.create({ repository });

  return { repository, service };
}

describe("AuthzScopeLineageService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not query when a request carries fewer than two scope ids", async () => {
    const { repository, service } = createService();

    await expect(service.check({ projectId: "project-1" })).resolves.toEqual({
      kind: "consistent",
    });
    expect(repository.tryFindProjectLineage).not.toHaveBeenCalled();
    expect(repository.tryFindTeamOrganization).not.toHaveBeenCalled();
  });

  it("accepts project, team and organization ids in one organization", async () => {
    const { service } = createService({
      projectOrganizations: { "project-1": "organization-1" },
      teamOrganizations: { "team-1": "organization-1" },
    });

    await expect(
      service.check({
        projectId: "project-1",
        teamId: "team-1",
        organizationId: "organization-1",
      }),
    ).resolves.toEqual({ kind: "consistent" });
  });

  it("fails closed when one mixed scope is unknown and records the resolved lineage", async () => {
    const { service } = createService({
      projectOrganizations: { "project-1": "organization-1" },
    });

    await expect(
      service.check({ projectId: "project-1", teamId: "unknown-team" }),
    ).resolves.toEqual({
      kind: "mismatch",
      widest: { tier: "team", id: "unknown-team" },
      entries: [
        { tier: "project", id: "project-1", organizationId: "organization-1" },
        { tier: "team", id: "unknown-team", organizationId: null },
      ],
    });
    expect(warn).toHaveBeenCalledWith(
      {
        scopes: [
          { tier: "project", id: "project-1", organizationId: "organization-1" },
          { tier: "team", id: "unknown-team", organizationId: null },
        ],
      },
      "refused: one request carries scope ids that do not resolve to one organization",
    );
  });

  it("fails closed when mixed scopes resolve to different organizations", async () => {
    const { service } = createService({
      projectOrganizations: { "project-1": "organization-1" },
      teamOrganizations: { "team-2": "organization-2" },
    });

    await expect(
      service.check({ projectId: "project-1", teamId: "team-2" }),
    ).resolves.toMatchObject({
      kind: "mismatch",
      widest: { tier: "team", id: "team-2" },
    });
  });

  it("names the widest supplied scope when an organization and project disagree", async () => {
    const { service } = createService({
      projectOrganizations: { "project-attacker": "organization-attacker" },
    });

    await expect(
      service.check({
        organizationId: "organization-victim",
        projectId: "project-attacker",
      }),
    ).resolves.toMatchObject({
      kind: "mismatch",
      widest: { tier: "organization", id: "organization-victim" },
    });
  });

  it("fails closed when an organization and unknown project are mixed", async () => {
    const { service } = createService();

    await expect(
      service.check({ organizationId: "organization-1", projectId: "missing-project" }),
    ).resolves.toMatchObject({
      kind: "mismatch",
      widest: { tier: "organization", id: "organization-1" },
    });
  });

  it("ignores empty and non-string values the same way the transport did", async () => {
    const { repository, service } = createService();

    await expect(service.check({ projectId: "", teamId: 42 })).resolves.toEqual({
      kind: "consistent",
    });
    expect(repository.tryFindProjectLineage).not.toHaveBeenCalled();
    expect(repository.tryFindTeamOrganization).not.toHaveBeenCalled();
  });
});
