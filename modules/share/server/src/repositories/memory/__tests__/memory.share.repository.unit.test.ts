import { describe, expect, it } from "vitest";
import { MemoryShareDatabase } from "../memory.share.database.ts";
import { MemoryShareRepository } from "../memory.share.repository.ts";

const PROJECT_ID = "project_1";
const TRACE_ID = "trace_1";

function build(traceSharingEnabled = true, organizationTraceSharingEnabled = true) {
  const memory = MemoryShareDatabase.create();
  memory.projects.push({
    id: PROJECT_ID,
    organizationId: "organization_1",
    traceSharingEnabled,
    organizationTraceSharingEnabled,
  });

  return { memory, repository: MemoryShareRepository.create({ memory }) };
}

const traceScope = {
  projectId: PROJECT_ID,
  resourceType: "TRACE" as const,
  resourceId: TRACE_ID,
};

describe("MemoryShareRepository", () => {
  describe("when a link is minted", () => {
    it("answers the same shape a token resolution returns", async () => {
      const { repository } = build();

      const link = await repository.create({ ...traceScope, token: "tok_a", maxViews: 1 });

      await expect(repository.findByToken("tok_a")).resolves.toMatchObject({
        id: link.id,
        projectId: PROJECT_ID,
        maxViews: 1,
        viewCount: 0,
        project: {
          traceSharingEnabled: true,
          team: { organization: { traceSharingEnabled: true } },
        },
      });
    });

    it("keeps a link out of another project's reach", async () => {
      const { repository } = build();
      const link = await repository.create({ ...traceScope, token: "tok_a" });

      await expect(
        repository.findById({ id: link.id, projectId: "project_other" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a capped link is opened", () => {
    it("consumes exactly the budget and refuses the next open", async () => {
      const { repository } = build();
      const link = await repository.create({ ...traceScope, token: "tok_a", maxViews: 1 });
      const consume = () =>
        repository.consumeView({ id: link.id, projectId: PROJECT_ID, maxViews: 1 });

      await expect(consume()).resolves.toBe(true);
      await expect(consume()).resolves.toBe(false);
    });
  });

  describe("when a resource is unshared", () => {
    it("drops every link for the resource and stops counting it as active", async () => {
      const { repository } = build();
      await repository.create({ ...traceScope, token: "tok_a" });
      await repository.create({ ...traceScope, token: "tok_b" });

      await expect(repository.countActiveForResource(traceScope)).resolves.toBe(2);

      await repository.deleteByResource(traceScope);

      await expect(repository.countActiveForResource(traceScope)).resolves.toBe(0);
      await expect(repository.findAllByResource(traceScope)).resolves.toEqual([]);
    });
  });
});
