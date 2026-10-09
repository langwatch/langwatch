import { PROJECT_KIND, type ProjectIdentity } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import type { ProjectRepository } from "../../repositories/project.repository.ts";
import { AggregateWritesService } from "../aggregate-writes.service.ts";

const identityOfKind = (kind: string | undefined): ProjectIdentity => ({
  id: "project_1",
  name: "Project",
  slug: "project",
  teamId: "team_1",
  organizationId: "org",
  isPersonal: false,
  ownerUserId: null,
  ...(kind === undefined ? {} : { kind }),
});

function serviceOver(identity: ProjectIdentity | null) {
  const findIdentity = vi.fn<ProjectRepository["findIdentity"]>().mockResolvedValue(identity);
  return { findIdentity, service: AggregateWritesService.create({ projects: { findIdentity } }) };
}

describe("AggregateWritesService (ADR-175 decision 8)", () => {
  describe("when the project is an aggregate", () => {
    it("refuses the write with the read-only code, answered forbidden", async () => {
      const { findIdentity, service } = serviceOver(identityOfKind(PROJECT_KIND.AGGREGATE));

      const refusal = await service
        .assertAcceptsWrites({ projectId: "project_1" })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "aggregate_project_is_read_only", httpStatus: 403 });
      await expect(service.acceptsWrites({ projectId: "project_1" })).resolves.toBe(false);
      expect(findIdentity).toHaveBeenCalledWith("project_1");
    });
  });

  describe("when the project is any other kind, or the reader does not know it", () => {
    it("lets the write through", async () => {
      for (const identity of [
        identityOfKind(PROJECT_KIND.APPLICATION),
        identityOfKind(PROJECT_KIND.INTERNAL_GOVERNANCE),
        identityOfKind(void 0),
        null,
      ]) {
        const { service } = serviceOver(identity);

        await expect(service.assertAcceptsWrites({ projectId: "project_1" })).resolves.toBe(void 0);
        await expect(service.acceptsWrites({ projectId: "project_1" })).resolves.toBe(true);
      }
    });
  });
});
