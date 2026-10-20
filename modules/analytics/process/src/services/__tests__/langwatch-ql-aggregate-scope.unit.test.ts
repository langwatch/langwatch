/**
 * Who an aggregate's LangWatchQL statement reads: the members its proof shares, under their own
 * keys and from where each grant opens.
 * @see specs/lwql/aggregate-reads.feature
 */
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../repositories/__tests__/analytics-proof.fixture.ts";
import { LangWatchQLAggregateScopeService } from "../langwatch-ql-aggregate-scope.service.ts";
import { project } from "./project.fixture.ts";

const AGGREGATE = "project_aggregate";
const SHARED_FROM = Date.parse("2026-03-01T00:00:00.000Z");

const KEYS: Record<string, string> = {
  [AGGREGATE]: "key_aggregate",
  project_a: "key_a",
  project_b: "key_b",
  project_c: "key_c",
};

function scopeOver({
  keys = KEYS,
  maxMembers,
}: { keys?: Record<string, string>; maxMembers?: number } = {}) {
  return LangWatchQLAggregateScopeService.create({
    projects: createApiFixture<ProjectApi>({
      findById: async (id) => {
        const lwqlKey = keys[id];
        return lwqlKey === undefined ? null : project(id, { lwqlKey });
      },
    }),
    ...(maxMembers === undefined ? {} : { maxMembers }),
  });
}

const aggregateProof = (
  shared = [
    { projectId: "project_a", from: 0 },
    { projectId: "project_b", from: SHARED_FROM },
  ],
) => analyticsProof({ projectId: AGGREGATE, shared });

const codeOf = (error: unknown) =>
  error instanceof Error && "code" in error ? String(error.code) : "unknown";

describe("LangWatchQLAggregateScopeService", () => {
  describe("given an aggregate whose members are project A and project B", () => {
    /** @scenario "The aggregate's statement runs under its members' keys" */
    it("runs under the members' keys, never the aggregate's own", async () => {
      const scope = await scopeOver().resolve({ authorization: aggregateProof() });

      expect(scope?.projects).toEqual([
        { id: "project_a", lwqlKey: "key_a" },
        { id: "project_b", lwqlKey: "key_b" },
      ]);
    });

    it("reads each member from where its grant opens", async () => {
      const scope = await scopeOver().resolve({ authorization: aggregateProof() });

      expect(scope?.memberWindows).toEqual([
        { projectId: "project_a", from: 0 },
        { projectId: "project_b", from: SHARED_FROM },
      ]);
    });

    /** @scenario "The members come from the proof, never from the request" */
    it("reads only the projects the proof shares, so project C is never read", async () => {
      const scope = await scopeOver().resolve({ authorization: aggregateProof() });

      expect(scope?.projects.map((project) => project.id)).not.toContain("project_c");
    });

    it("leaves out a member whose grant has an end", async () => {
      const scope = await scopeOver().resolve({
        authorization: aggregateProof([
          { projectId: "project_a", from: 0 },
          { projectId: "project_b", from: 0, until: SHARED_FROM },
        ]),
      });

      expect(scope?.projects.map((project) => project.id)).toEqual(["project_a"]);
    });
  });

  describe("given a member whose LangWatchQL key cannot be read", () => {
    /** @scenario "A member whose key cannot be read is refused by name" */
    it("refuses the run naming that member", async () => {
      const { project_b: _missing, ...keys } = KEYS;

      const refusal = await scopeOver({ keys })
        .resolve({ authorization: aggregateProof() })
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("lwql_member_key_missing");
      expect(refusal).toMatchObject({ meta: { projectIds: ["project_b"] } });
    });
  });

  describe("given more members than one statement may name", () => {
    /** @scenario "Too many members is refused before any read" */
    it("refuses before reading any member", async () => {
      const refusal = await scopeOver({ keys: {}, maxMembers: 1 })
        .resolve({ authorization: aggregateProof() })
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("lwql_too_many_members");
      expect(refusal).toMatchObject({ meta: { memberCount: 2, maxMembers: 1 } });
    });
  });

  describe("given a plain project's proof", () => {
    /** @scenario "A plain project still runs under its own key alone" */
    it("adds no members, so the run keeps its own key", async () => {
      const scope = await scopeOver().resolve({
        authorization: analyticsProof({ projectId: "project_plain" }),
      });

      expect(scope).toBeUndefined();
    });
  });
});
