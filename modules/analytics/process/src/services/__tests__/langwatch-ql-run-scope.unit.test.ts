/**
 * Which projects one member's run reads: the caller's own, an aggregate's members, or a named set.
 * @see specs/lwql/query-params.feature
 * @vitest-environment node
 */
import { LWQL_PROJECTS_SEND_ALL_OR_LIST } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../repositories/__tests__/analytics-proof.fixture.ts";
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

  /** @scenario "QP03f projects accepts the word all for every project the caller can read" */
  it("refuses the word all in a list, in any case, with its own message", () => {
    for (const word of ["all", "ALL", " All "]) {
      expect(() => service.select({ projects: ["B", word] })).toThrow(
        '"all" stands alone; send it by itself, or list project ids',
      );
    }
  });

  it("refuses a stray string with a 422 instead of reading it as a list", () => {
    expect(() => service.select({ projects: "al" as never })).toThrow(
      expect.objectContaining({ httpStatus: 422, message: LWQL_PROJECTS_SEND_ALL_OR_LIST }),
    );
  });

  it("does not refuse exactly all", () => {
    expect(service.select({ projects: "all" })).toMatchObject({ all: true });
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

    expect(asked).toEqual([{ userId: "u", projectIds: ["A", "B"], anchorProjectId: "A" }]);
  });
});

describe("resolve", () => {
  /** @scenario "QP03f2 The word all on an aggregate project's card reads the whole aggregate" */
  it("reads the whole aggregate for all, without asking for the organization's projects", async () => {
    const members = {
      projects: [{ id: "a", lwqlKey: "key_a" }],
      memberWindows: [{ projectId: "a", from: 0 }],
    };
    const aggregate = LangWatchQLRunScopeService.create({
      queryScope: { resolveMemberProjects: () => Promise.reject(new Error("not asked")) },
      aggregateScope: { getMemberScope: () => Promise.resolve(members) },
      readable: { allIdsFor: () => Promise.resolve(["a", "b", "c"]) },
      bounds: { assertQueryWithinBounds: () => Promise.resolve() },
    });

    const scope = await aggregate.resolve({
      authorization: analyticsProof({ projectId: "agg", shared: [{ projectId: "a", from: 0 }] }),
      project: { id: "agg", lwqlKey: "key_agg" },
      selection: { named: undefined, all: true },
      userId: "user-1",
    });

    expect(scope).toEqual({ kind: "aggregate", ...members });
  });
});
