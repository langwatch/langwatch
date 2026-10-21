/**
 * Who an aggregate's LangWatchQL statement reads: the members its proof shares, under their own
 * keys and from where each grant opens.
 * @see specs/lwql/aggregate-reads.feature
 */
import { type Authorization, sharedWindowsReadBy } from "@langwatch/authorization";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  analyticsProof,
  type TestSharedWindow,
} from "../../repositories/__tests__/analytics-proof.fixture.ts";
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
  shared: readonly TestSharedWindow[] = [
    { projectId: "project_a", from: 0 },
    { projectId: "project_b", from: SHARED_FROM },
  ],
) => analyticsProof({ projectId: AGGREGATE, shared });

/** The windows the app hands the service: the proof's shared `analytics:view` trace grants. */
const sharedOf = (authorization: Authorization) =>
  sharedWindowsReadBy({ authorization, permission: "analytics:view", condition: "trace" });

const codeOf = (error: unknown) =>
  error instanceof Error && "code" in error ? String(error.code) : "unknown";

describe("LangWatchQLAggregateScopeService", () => {
  describe("given an aggregate whose members are project A and project B", () => {
    /** @scenario "The aggregate's statement runs under its members' keys" */
    it("runs under the members' keys, never the aggregate's own", async () => {
      const scope = await scopeOver().getMemberScope({ shared: sharedOf(aggregateProof()) });

      expect(scope.projects).toEqual([
        { id: "project_a", lwqlKey: "key_a" },
        { id: "project_b", lwqlKey: "key_b" },
      ]);
    });

    it("reads each member from where its grant opens", async () => {
      const scope = await scopeOver().getMemberScope({ shared: sharedOf(aggregateProof()) });

      expect(scope.memberWindows).toEqual([
        { projectId: "project_a", from: 0 },
        { projectId: "project_b", from: SHARED_FROM },
      ]);
    });

    /** @scenario "The members come from the proof, never from the request" */
    it("reads only the projects the proof shares, so project C is never read", async () => {
      const scope = await scopeOver().getMemberScope({ shared: sharedOf(aggregateProof()) });

      expect(scope.projects.map((project) => project.id)).not.toContain("project_c");
    });

    it("leaves out a member whose grant has an end", async () => {
      const scope = await scopeOver().getMemberScope({
        shared: sharedOf(
          aggregateProof([
            { projectId: "project_a", from: 0 },
            { projectId: "project_b", from: 0, until: SHARED_FROM },
          ]),
        ),
      });

      expect(scope.projects.map((project) => project.id)).toEqual(["project_a"]);
    });
  });

  describe("given a member whose LangWatchQL key cannot be read", () => {
    /** @scenario "A member whose key cannot be read is refused by name" */
    it("refuses the run naming that member", async () => {
      const { project_b: _missing, ...keys } = KEYS;

      const refusal = await scopeOver({ keys })
        .getMemberScope({ shared: sharedOf(aggregateProof()) })
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("lwql_member_key_missing");
      expect(refusal).toMatchObject({ meta: { projectIds: ["project_b"], projectNames: [] } });
    });

    it("names a member that exists but has no key, so the page can say which", async () => {
      const refusal = await LangWatchQLAggregateScopeService.create({
        projects: createApiFixture<ProjectApi>({
          findById: async (id) =>
            project(id, {
              name: `Name of ${id}`,
              lwqlKey: id === "project_b" ? "" : (KEYS[id] ?? ""),
            }),
        }),
      })
        .getMemberScope({ shared: sharedOf(aggregateProof()) })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        meta: { projectIds: ["project_b"], projectNames: ["Name of project_b"] },
      });
    });
  });

  describe("given more members than one statement may name", () => {
    /** @scenario "Too many members is refused before any read" */
    it("refuses before reading any member", async () => {
      const refusal = await scopeOver({ keys: {}, maxMembers: 1 })
        .getMemberScope({ shared: sharedOf(aggregateProof()) })
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("lwql_too_many_members");
      expect(refusal).toMatchObject({ meta: { memberCount: 2, maxMembers: 1 } });
    });
  });

  describe("given a plain project's proof", () => {
    /** @scenario "A plain project still runs under its own key alone" */
    it("shares no windows, so the app never asks for members and the run keeps its own key", () => {
      expect(sharedOf(analyticsProof({ projectId: "project_plain" }))).toEqual([]);
    });
  });
});
