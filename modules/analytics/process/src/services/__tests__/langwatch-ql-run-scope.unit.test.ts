/**
 * Which projects one member's run reads: the caller's own, an aggregate's members, or a named set.
 * @see specs/lwql/query-params.feature
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { LangWatchQLRunScopeService } from "../langwatch-ql-run-scope.service.ts";

const service = LangWatchQLRunScopeService.create({
  queryScope: { resolveMemberProjects: () => Promise.reject(new Error("not asked")) },
  aggregateScope: { getMemberScope: () => Promise.reject(new Error("not asked")) },
  bounds: { assertQueryWithinBounds: () => Promise.resolve() },
});

describe("select", () => {
  /** @scenario "QP12d A run that names both projectId and projects is refused" */
  it("refuses a request that names both projectId and projects", () => {
    expect(() => service.select({ projectId: "A", projects: ["B"] })).toThrow(
      "send projectId or projects, not both",
    );
    expect(() => service.select({ projectId: "A", projects: ["B"] })).toThrow(
      expect.objectContaining({ code: "validation_error", httpStatus: 422 }),
    );
  });

  it("answers the names, or none", () => {
    expect(service.select({ projects: ["B"] }).named).toEqual(["B"]);
    expect(service.select({}).named).toBeUndefined();
  });
});

describe("resolve", () => {
  it("reads the caller's own project when it names none or only itself", async () => {
    const project = { id: "A", lwqlKey: "ka" };

    expect(
      await service.resolve({ authorization: undefined, project, named: undefined, userId: "u" }),
    ).toEqual({ kind: "own" });
    expect(
      await service.resolve({ authorization: undefined, project, named: ["A"], userId: "u" }),
    ).toEqual({ kind: "own" });
  });

  it("refuses a named set with no signed-in member to prove it", async () => {
    await expect(
      service.resolve({
        authorization: undefined,
        project: { id: "A", lwqlKey: "ka" },
        named: ["B"],
        userId: undefined,
      }),
    ).rejects.toMatchObject({ code: "project_not_found", httpStatus: 404 });
  });
});
