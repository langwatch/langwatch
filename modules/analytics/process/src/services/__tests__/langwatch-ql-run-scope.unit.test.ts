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
  readable: { allIdsFor: () => Promise.reject(new Error("not asked")) },
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

  /** @scenario "QP03f projects accepts the word all for every project the caller can read" */
  it('reads "all" as a choice, and refuses it beside projectId with the one conflict message', () => {
    expect(service.select({ projects: "all" })).toEqual({ named: undefined, all: true });
    expect(() => service.select({ projectId: "A", projects: "all" })).toThrow(
      "send projectId or projects, not both",
    );
  });
});

describe("resolve", () => {
  it("reads the caller's own project when it names none or only itself", async () => {
    const project = { id: "A", lwqlKey: "ka" };

    expect(
      await service.resolve({
        authorization: undefined,
        project,
        selection: { named: undefined, all: false },
        userId: "u",
      }),
    ).toEqual({ kind: "own" });
    expect(
      await service.resolve({
        authorization: undefined,
        project,
        selection: { named: ["A"], all: false },
        userId: "u",
      }),
    ).toEqual({ kind: "own" });
  });

  it("refuses a named set with no signed-in member to prove it", async () => {
    await expect(
      service.resolve({
        authorization: undefined,
        project: { id: "A", lwqlKey: "ka" },
        selection: { named: ["B"], all: false },
        userId: undefined,
      }),
    ).rejects.toMatchObject({ code: "project_not_found", httpStatus: 404 });
  });

  /** @scenario "QP03f projects accepts the word all for every project the caller can read" */
  it('asks for the member\'s grants once for "all", then reads that list unasked', async () => {
    const asked: unknown[] = [];
    const once = LangWatchQLRunScopeService.create({
      queryScope: {
        resolveMemberProjects: (input) => {
          asked.push(input);
          return Promise.resolve({ projects: [], protections: {} as never });
        },
      },
      aggregateScope: { getMemberScope: () => Promise.reject(new Error("not asked")) },
      readable: { allIdsFor: () => Promise.resolve(["A", "B"]) },
      bounds: { assertQueryWithinBounds: () => Promise.resolve() },
    });

    await once.resolve({
      authorization: undefined,
      project: { id: "A", lwqlKey: "ka" },
      selection: { named: undefined, all: true },
      userId: "u",
    });

    expect(asked).toEqual([{ userId: "u", projectIds: ["A", "B"], alreadyAuthorized: true }]);
  });
});
