/**
 * The half of pull-request linkage that knows a project.
 *
 * Demand arrives with a tenant: a session is looking at a branch right now, so
 * the organization has to be resolved from the project, the branch's next sweep
 * is pulled forward, and a mapping that finds a pull request is what marks the
 * project as having seen coding-agent activity. The fleet-wide sweep does none
 * of that — it has no project in hand — which is why the two are separate
 * services and only this one takes a `ProjectService`.
 *
 * Spec: packages/features/github/specs/github-branch-maintenance.feature
 */
import { describe, expect, it } from "vitest";

import { GithubHostPort } from "../../ports/github-host.port";
import type { BranchMappingTarget } from "../github-branch-mapping.service";
import { GithubBranchDemandService } from "../github-branch-demand.service";
import { TestProjectService } from "./fixtures/github-services.fixture";

const REQUEST = {
  tenantId: "project-1",
  repositoryHost: "github.com",
  repositoryOwner: "acme",
  repositoryName: "refunds",
  headBranch: "feat/refunds",
};

/** An instance that is a GitHub App on github.com, which is all demand reads. */
class TestHost extends GithubHostPort {
  getHost(): string {
    return "github.com";
  }

  getApiBase(): string {
    return "https://api.github.com";
  }

  getWebBase(): string {
    return "https://github.com";
  }

  getAppInstallUrl(): string {
    return "https://github.com/apps/langwatch/installations/new";
  }

  isMappable(repositoryHost: string): boolean {
    return repositoryHost === "github.com";
  }

  normalize(repositoryHost: string): string {
    return repositoryHost.toLowerCase();
  }
}

/** The sweep-side mapping, reduced to what demand asks of it. */
class RecordingMapping {
  readonly broughtForward: BranchMappingTarget[] = [];
  readonly mapped: BranchMappingTarget[] = [];

  constructor(private readonly found: number) {}

  async bringRecheckForward(target: BranchMappingTarget): Promise<void> {
    this.broughtForward.push(target);
  }

  async map(target: BranchMappingTarget): Promise<number> {
    this.mapped.push(target);
    return this.found;
  }
}

function demand(found: number, project = new TestProjectService("organization-1")) {
  const mapping = new RecordingMapping(found);
  const service = GithubBranchDemandService.create({
    mapping,
    project,
    host: new TestHost(),
    now: () => Date.UTC(2026, 7, 2),
  });
  return { service, mapping, project };
}

describe("GitHub branch demand", () => {
  describe("given a mapping that finds a pull request", () => {
    /** @scenario "A demanded mapping that finds a pull request records project activity" */
    it("records the activity against the project that asked", async () => {
      const { service, project } = demand(1);

      await service.request(REQUEST);

      expect(project.pullRequestActivity).toEqual([
        { projectId: "project-1", at: new Date(Date.UTC(2026, 7, 2)) },
      ]);
    });

    /** @scenario "A demanded branch is pulled into the active sweep window" */
    it("pulls the branch's next sweep forward before mapping it", async () => {
      const { service, mapping } = demand(1);

      await service.request(REQUEST);

      expect(mapping.broughtForward).toEqual([
        {
          organizationId: "organization-1",
          repositoryHost: "github.com",
          repositoryOwner: "acme",
          repositoryName: "refunds",
          headBranch: "feat/refunds",
          origin: "demand",
        },
      ]);
      expect(mapping.mapped).toEqual(mapping.broughtForward);
    });
  });

  describe("given a mapping that finds nothing", () => {
    /** @scenario "A demanded mapping that finds nothing leaves project activity alone" */
    it("leaves the project's activity untouched", async () => {
      const { service, project } = demand(0);

      await service.request(REQUEST);

      expect(project.pullRequestActivity).toEqual([]);
    });
  });

  describe("given the project activity write fails", () => {
    /** @scenario "A failed project-activity write does not fail the mapping" */
    it("still completes the request", async () => {
      const project = new TestProjectService("organization-1");
      project.pullRequestActivityError = new Error("project gone");
      const { service } = demand(1, project);

      await expect(service.request(REQUEST)).resolves.toBeUndefined();
    });
  });

  describe("given a host this instance cannot map", () => {
    /** @scenario "An unmappable repository host is never resolved to an organization" */
    it("never resolves the tenant, so nothing is read or written", async () => {
      const { service, mapping, project } = demand(1);

      await service.request({ ...REQUEST, repositoryHost: "gitlab.com" });

      expect(mapping.mapped).toEqual([]);
      expect(project.pullRequestActivity).toEqual([]);
    });
  });
});
