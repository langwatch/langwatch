/**
 * The readable-project resolver: which projects one key's LangWatchQL query
 * runs across (#8085).
 *
 * The selection is a pure function of the candidates and the per-project
 * `analytics:view` verdict, so the cases that matter — a project key resolving
 * to one, an org key resolving to none / one / many, and a project whose
 * permission is withheld being excluded — are asserted directly, with fakes for
 * the organization enumeration and the permission cut.
 *
 * @see ../readableProjects.ts
 * @see specs/lwql/api.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  type LwqlProjectCandidate,
  resolveLwqlReadableProjects,
  selectReadableLwqlProjects,
} from "../readableProjects";

const candidate = (id: string): LwqlProjectCandidate => ({
  id,
  lwqlKey: `sk-lw-${id}`,
  teamId: `team-${id}`,
});

/** A prisma double whose `project.findMany` returns the given candidates. */
function fakePrisma(candidates: LwqlProjectCandidate[]): {
  prisma: PrismaClient;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn().mockResolvedValue(candidates);
  return {
    prisma: { project: { findMany } } as unknown as PrismaClient,
    findMany,
  };
}

/** A viewable cut that admits exactly the named project ids. */
const admitting = (ids: string[]) => async () => (projectId: string) =>
  ids.includes(projectId);

describe("given candidate projects and an analytics:view verdict", () => {
  describe("when the readable set is selected", () => {
    /** @scenario "The readable project set is every project the key grants analytics:view on" */
    it("keeps only the projects the verdict admits, carrying their lwqlKey", () => {
      const selected = selectReadableLwqlProjects({
        candidates: [candidate("a"), candidate("b"), candidate("c")],
        canView: (id) => id !== "b",
      });

      expect(selected).toEqual([
        { id: "a", lwqlKey: "sk-lw-a" },
        { id: "c", lwqlKey: "sk-lw-c" },
      ]);
    });

    /** @scenario "The readable project set is every project the key grants analytics:view on" */
    it("excludes a project whose permission is withheld, and never widens beyond the verdict", () => {
      const selected = selectReadableLwqlProjects({
        candidates: [candidate("a"), candidate("b")],
        // Absent verdict denies: a project the cut did not answer for is out.
        canView: () => false,
      });

      expect(selected).toEqual([]);
    });
  });
});

describe("given a LangWatchQL caller credential", () => {
  describe("when it is a single-project credential", () => {
    /** @scenario "The readable project set is every project the key grants analytics:view on" */
    it("resolves to exactly its own project, without enumerating the organization", async () => {
      const { prisma, findMany } = fakePrisma([]);
      const viewableCut = vi.fn();

      const projects = await resolveLwqlReadableProjects({
        credential: {
          kind: "project",
          project: { id: "p1", lwqlKey: "sk-lw-p1" },
        },
        viewableCut,
        prisma,
      });

      expect(projects).toEqual([{ id: "p1", lwqlKey: "sk-lw-p1" }]);
      expect(findMany).not.toHaveBeenCalled();
      expect(viewableCut).not.toHaveBeenCalled();
    });
  });

  describe("when it is an API key over an organization", () => {
    /** @scenario "The readable project set is every project the key grants analytics:view on" */
    it("resolves to every project the key can read — many", async () => {
      const { prisma } = fakePrisma([
        candidate("a"),
        candidate("b"),
        candidate("c"),
      ]);

      const projects = await resolveLwqlReadableProjects({
        credential: { kind: "apiKey", organizationId: "org-1" },
        viewableCut: admitting(["a", "c"]),
        prisma,
      });

      expect(projects).toEqual([
        { id: "a", lwqlKey: "sk-lw-a" },
        { id: "c", lwqlKey: "sk-lw-c" },
      ]);
    });

    /** @scenario "The readable project set is every project the key grants analytics:view on" */
    it("resolves to exactly one when the key can read a single project", async () => {
      const { prisma } = fakePrisma([candidate("a"), candidate("b")]);

      const projects = await resolveLwqlReadableProjects({
        credential: { kind: "apiKey", organizationId: "org-1" },
        viewableCut: admitting(["b"]),
        prisma,
      });

      expect(projects).toEqual([{ id: "b", lwqlKey: "sk-lw-b" }]);
    });

    /** @scenario "The readable project set is every project the key grants analytics:view on" */
    it("resolves to none — a valid zero-row scope — when the key can read nothing", async () => {
      const { prisma } = fakePrisma([candidate("a"), candidate("b")]);

      const projects = await resolveLwqlReadableProjects({
        credential: { kind: "apiKey", organizationId: "org-1" },
        viewableCut: admitting([]),
        prisma,
      });

      expect(projects).toEqual([]);
    });

    it("short-circuits an organization with no projects without asking the cut", async () => {
      const { prisma } = fakePrisma([]);
      const viewableCut = vi.fn();

      const projects = await resolveLwqlReadableProjects({
        credential: { kind: "apiKey", organizationId: "org-empty" },
        viewableCut,
        prisma,
      });

      expect(projects).toEqual([]);
      expect(viewableCut).not.toHaveBeenCalled();
    });
  });
});
