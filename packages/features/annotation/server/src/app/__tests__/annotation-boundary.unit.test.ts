import {
  AnnotationAnnotatorInvalidError,
  AnnotationNotFoundError,
  AnnotationQueueMemberInvalidError,
  AnnotationScoreInvalidError,
} from "@langwatch/annotation-contract";
import { UserNotInOrganizationError } from "@langwatch/organization-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import {
  createAnnotationTestApp,
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
} from "./annotation.fixture.ts";

describe("AnnotationApp boundary", () => {
  /** @scenario "a required annotation lookup throws" */
  it("throws when an annotation is absent", async () => {
    const app = createAnnotationTestApp();

    await expect(app.getById({ id: "missing", projectId: "project-1" })).rejects.toBeInstanceOf(
      AnnotationNotFoundError,
    );
  });

  /** @scenario "annotation input is validated by the contract" */
  it("refuses an incomplete anchor", () => {
    const app = createAnnotationTestApp();

    expect(() =>
      app.create({
        id: "annotation-2",
        projectId: "project-1",
        traceId: "trace-1",
        userId: "user-1",
        comment: "comment",
        isThumbsUp: null,
        scoreOptions: {},
        expectedOutput: null,
        anchorKind: "field",
      }),
    ).toThrow();
  });

  /** @scenario "queue references use their owning services" */
  it("checks distinct queue members in one organization batch", async () => {
    const projects = createAnnotationTestProjects();
    const organizations = createAnnotationTestOrganizations();
    const app = createAnnotationTestApp({ dependencies: { projects, organizations } });

    await app.configure({
      projectId: "project-1",
      name: "Reviews",
      description: "",
      userIds: ["user-1", "user-2", "user-1"],
      scoreTypeIds: [],
    });

    expect(projects.getOrganizationId).toHaveBeenCalledWith("project-1");

    expect(organizations.getOrganizationMembers).toHaveBeenCalledWith({
      organizationId: "organization-1",
      userIds: ["user-1", "user-2"],
    });
  });

  it("returns projection rows from the annotation repository", async () => {
    const app = createAnnotationTestApp();

    await app.create({
      id: "annotation-1",
      projectId: "project-1",
      traceId: "trace-1",
      comment: "comment",
      isThumbsUp: null,
      scoreOptions: {},
      expectedOutput: null,
    });

    await expect(
      app.listForProjection({ projectId: "project-1", traceIds: ["trace-1"], anchor: "all" }),
    ).resolves.toMatchObject([{ id: "annotation-1", traceId: "trace-1" }]);
  });

  /** @scenario "queue references use their owning services" */
  it("rejects queue members and scores outside the project boundary", async () => {
    const organizations = createAnnotationTestOrganizations();

    organizations.getOrganizationMembers.mockRejectedValueOnce(
      new UserNotInOrganizationError("user-1"),
    );

    const app = createAnnotationTestApp({ dependencies: { organizations } });

    await expect(
      app.configure({
        projectId: "project-1",
        name: "Reviews",
        description: "",
        userIds: ["user-1"],
        scoreTypeIds: [],
      }),
    ).rejects.toBeInstanceOf(AnnotationQueueMemberInvalidError);

    await expect(
      app.configure({
        projectId: "project-1",
        name: "Reviews",
        description: "",
        userIds: [],
        scoreTypeIds: ["score-1"],
      }),
    ).rejects.toBeInstanceOf(AnnotationScoreInvalidError);
  });

  it("rejects annotator references outside the project boundary", async () => {
    const app = createAnnotationTestApp();

    await expect(
      app.queueTraces({
        projectId: "project-1",
        traceIds: ["trace-1"],
        annotators: ["queue-1", "user-1"],
        userId: "actor-1",
      }),
    ).rejects.toBeInstanceOf(AnnotationAnnotatorInvalidError);
  });

  it("propagates the original project not-found error", async () => {
    const error = new ProjectNotFoundError("missing");
    const projects = createAnnotationTestProjects();

    projects.getOrganizationId = vi.fn(async () => {
      throw error;
    });

    const app = createAnnotationTestApp({ dependencies: { projects } });

    await expect(
      app.configure({
        projectId: "missing",
        name: "Reviews",
        description: "",
        userIds: [],
        scoreTypeIds: [],
      }),
    ).rejects.toBe(error);
  });
});
