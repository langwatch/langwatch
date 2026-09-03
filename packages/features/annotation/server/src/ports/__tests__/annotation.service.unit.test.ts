import {
  AnnotationAnnotatorInvalidError,
  type Annotation,
  AnnotationNotFoundError,
  AnnotationProjectNotFoundError,
  AnnotationQueueMemberInvalidError,
  AnnotationScoreInvalidError,
} from "@langwatch/annotation-contract";
import { UserNotInOrganizationError } from "@langwatch/organization-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { AnnotationRepository } from "../annotation.port";
import { AnnotationService } from "../../services/annotation.service";
import {
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
} from "./annotation.test-services";

const annotation = {
  id: "annotation-1",
  projectId: "project-1",
  traceId: "trace-1",
  userId: "user-1",
  email: null,
  comment: "comment",
  isThumbsUp: null,
  scoreOptions: {},
  expectedOutput: null,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Annotation;

class FakeRepository extends AnnotationRepository {
  readonly getById = vi.fn(async (): Promise<Annotation> => annotation);
  create = vi.fn(async () => annotation);
  update = vi.fn(async () => annotation);
  delete = vi.fn(async () => annotation);
  list = vi.fn(async () => [annotation]);
  listForProjection = vi.fn(async () => []);
  listScoreNames = vi.fn(async () => []);
  upsertScore = vi.fn(async () => {
    throw new Error("not implemented in this fake");
  });
  listScores = vi.fn(async () => []);
  getScore = vi.fn(async () => {
    throw new Error("not implemented in this fake");
  });
  toggleScore = vi.fn(async () => {
    throw new Error("not implemented in this fake");
  });
  deleteScore = vi.fn(async () => {
    throw new Error("not implemented in this fake");
  });
  createQueueItems = vi.fn(async () => void 0);
  countAnnotationScores = vi.fn(
    async ({ scoreTypeIds }: { scoreTypeIds: string[] }) => scoreTypeIds.length,
  );
  countAnnotationQueues = vi.fn(
    async ({ queueIds }: { queueIds: string[] }) => queueIds.length,
  );
}

function createService(repository: FakeRepository) {
  const projects = createAnnotationTestProjects();
  const organizations = createAnnotationTestOrganizations();
  return {
    service: AnnotationService.create({ repository, projects, organizations }),
    projects,
    organizations,
  };
}

describe("AnnotationService", () => {
  /** @scenario "a required annotation lookup throws" */
  it("throws at the service boundary when an annotation is absent", async () => {
    const repository = new FakeRepository();
    repository.getById.mockRejectedValue(new AnnotationNotFoundError("missing"));
    const { service } = createService(repository);

    await expect(
      service.getById({ id: "missing", projectId: "project-1" }),
    ).rejects.toBeInstanceOf(AnnotationNotFoundError);
  });

  /** @scenario "annotation input is validated by the contract" */
  it("refuses an incomplete anchor before the repository is reached", () => {
    const repository = new FakeRepository();
    const { service } = createService(repository);

    expect(() =>
      service.create({
        id: "annotation-2",
        projectId: "project-1",
        traceId: "trace-1",
        userId: "user-1",
        comment: "comment",
        isThumbsUp: null,
        expectedOutput: null,
        anchorKind: "field",
      } as never),
    ).toThrow();

    expect(repository.create).not.toHaveBeenCalled();
  });

  /** @scenario "queue references use their owning services" */
  it("reads every queue member in one organization batch", async () => {
    const repository = new FakeRepository();
    const { service, projects, organizations } = createService(repository);

    await service.assertQueueConfigurationReferences({
      projectId: "project-1",
      userIds: ["user-1", "user-2", "user-1"],
      scoreTypeIds: ["score-1"],
    });

    expect(projects.getOrganizationId).toHaveBeenCalledWith("project-1");
    expect(organizations.getOrganizationMembers).toHaveBeenCalledTimes(1);
    expect(organizations.getOrganizationMembers).toHaveBeenCalledWith({
      organizationId: "organization-1",
      userIds: ["user-1", "user-2"],
    });
  });

  it("delegates projection reads through the private repository", async () => {
    const repository = new FakeRepository();
    const { service } = createService(repository);

    await service.listForProjection({
      projectId: "project-1",
      traceIds: ["trace-1"],
      anchor: "all",
    });

    expect(repository.listForProjection).toHaveBeenCalledWith({
      projectId: "project-1",
      traceIds: ["trace-1"],
      anchor: "all",
    });
  });

  /** @scenario "queue references use their owning services" */
  it("rejects queue members and scores outside the project boundary", async () => {
    const repository = new FakeRepository();
    const { service, organizations } = createService(repository);
    organizations.getOrganizationMembers.mockRejectedValueOnce(
      new UserNotInOrganizationError("user-1"),
    );
    await expect(
      service.assertQueueConfigurationReferences({
        projectId: "project-1",
        userIds: ["user-1"],
        scoreTypeIds: [],
      }),
    ).rejects.toBeInstanceOf(AnnotationQueueMemberInvalidError);

    repository.countAnnotationScores.mockResolvedValueOnce(0);
    await expect(
      service.assertQueueConfigurationReferences({
        projectId: "project-1",
        userIds: [],
        scoreTypeIds: ["score-1"],
      }),
    ).rejects.toBeInstanceOf(AnnotationScoreInvalidError);
  });

  it("rejects annotator references outside the project boundary", async () => {
    const repository = new FakeRepository();
    repository.countAnnotationQueues.mockResolvedValue(0);
    const { service } = createService(repository);

    await expect(
      service.assertAnnotatorReferences({
        projectId: "project-1",
        queueIds: ["queue-1"],
        userIds: ["user-1"],
      }),
    ).rejects.toBeInstanceOf(AnnotationAnnotatorInvalidError);
  });

  it("maps project absence to the established annotation 404 error", async () => {
    const repository = new FakeRepository();
    const { service, projects } = createService(repository);
    projects.getOrganizationId.mockRejectedValueOnce(new ProjectNotFoundError("missing"));

    await expect(
      service.getProjectOrganizationId({ projectId: "missing" }),
    ).rejects.toBeInstanceOf(AnnotationProjectNotFoundError);
  });
});
