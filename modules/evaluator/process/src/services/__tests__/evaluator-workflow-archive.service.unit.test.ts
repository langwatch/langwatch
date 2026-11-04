import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryEvaluatorRepository } from "../../repositories/memory/memory.evaluator.repository.ts";
import { EvaluatorVersionService } from "../evaluator-version.service.ts";
import { EvaluatorWorkflowArchiveService } from "../evaluator-workflow-archive.service.ts";

const projectId = "project-1";
const workflowId = "workflow-1";

async function setup(input: { deployed: boolean }) {
  const repository = MemoryEvaluatorRepository.create();
  const versions = EvaluatorVersionService.create({
    repository,
    users: createApiFixture<UserApi>({ getProfiles: async () => [] }),
    permissions: createApiFixture<AuthzApi>({
      getScope: async () => ({ type: "project", id: projectId }) as never,
      can: async () => true,
    }),
    auditLog: createApiFixture<AuditLogApi>({ listEntityHistory: async () => [] }),
  });
  await repository.create({
    id: "evaluator-1",
    projectId,
    name: "Workflow judge",
    type: "workflow",
    config: {},
    workflowId,
  });
  if (input.deployed) {
    const [version] = await repository.findVersions({ projectId, evaluatorId: "evaluator-1" });
    await repository.assignLabel({
      projectId,
      evaluatorId: "evaluator-1",
      label: "production",
      versionId: version!.id,
      actorId: null,
    });
  }
  const deleted: string[] = [];
  const service = EvaluatorWorkflowArchiveService.create({
    evaluators: {
      findByWorkflow: async (scope) => {
        const found = await repository.findByWorkflow(scope);
        return found ? [found] : [];
      },
      archive: (scope) => repository.archive(scope),
    },
    versions,
    deletionFacts: {
      recordEvaluatorDeleted: async ({ evaluatorId }) => {
        deleted.push(evaluatorId);
      },
    },
  });
  return { repository, service, deleted };
}

describe("archiving the evaluators of an archived workflow", () => {
  /** @scenario "Archiving a workflow leaves its deployed evaluator live" */
  it("keeps a deployed evaluator live and records no deletion for it", async () => {
    const { repository, service, deleted } = await setup({ deployed: true });

    await service.archiveForWorkflow({ projectId, workflowId });

    expect((await repository.findById({ id: "evaluator-1", projectId }))?.archivedAt).toBeNull();
    expect(deleted).toEqual([]);
  });

  /** @scenario "Archiving a workflow leaves its deployed evaluator live" */
  it("archives an evaluator no label points at and records its deletion", async () => {
    const { repository, service, deleted } = await setup({ deployed: false });

    await service.archiveForWorkflow({ projectId, workflowId });

    expect(await repository.findById({ id: "evaluator-1", projectId })).toBeUndefined();
    expect(deleted).toEqual(["evaluator-1"]);
  });
});
