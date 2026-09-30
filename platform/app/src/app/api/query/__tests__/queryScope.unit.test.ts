/**
 * The query door's scope resolution, exercised without a mounted app or a
 * database — every dependency is injected.
 *
 * The property under test: a key reaches exactly the projects it can read and
 * no more, a permissionless key reaches none (an empty scope, never a
 * refusal), and content is redacted to the strictest protection across the set.
 *
 * @see ../[[...route]]/queryScope
 * @see specs/lwql/api.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { KeyPrincipal } from "~/server/api-key/auth-middleware";
import type { Protections } from "~/server/traces/protections";
import {
  type ProjectCutsProvider,
  resolveLwqlQueryScope,
  strictestLwqlProtections,
} from "../[[...route]]/queryScope";

const fullProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

/** A prisma whose only used method is the candidate enumeration. */
function fakePrisma(
  candidates: Array<{ id: string; lwqlKey: string; teamId: string }>,
) {
  return {
    project: { findMany: vi.fn().mockResolvedValue(candidates) },
  } as unknown as Parameters<typeof resolveLwqlQueryScope>[0]["prisma"];
}

/** A permissions service that grants `analytics:view` on exactly `granted`. */
function fakePermissions(granted: Set<string>): ProjectCutsProvider {
  return {
    apiKeyProjectCuts: vi.fn(async ({ projects }) => {
      const byProject = new Map<string, boolean>(
        projects.map((p: { projectId: string }) => [
          p.projectId,
          granted.has(p.projectId),
        ]),
      );
      return new Map([["analytics:view", byProject]]);
    }),
  } as unknown as ProjectCutsProvider;
}

const projectPrincipal = (id: string): KeyPrincipal =>
  ({
    kind: "project",
    project: {
      id,
      lwqlKey: `key-${id}`,
      team: { id: "t1", organizationId: "org" },
    },
  }) as KeyPrincipal;

const apiKeyPrincipal: KeyPrincipal = {
  kind: "apiKey",
  apiKeyId: "ak1",
  userId: "u1",
  organizationId: "org",
};

describe("given a project API key", () => {
  describe("when the query scope is resolved", () => {
    it("passes exactly its own project to the service, without fanning out", async () => {
      const permissions = fakePermissions(new Set());
      const { projects } = await resolveLwqlQueryScope({
        principal: projectPrincipal("A"),
        permissions,
        prisma: fakePrisma([]),
        protectionsFor: async () => fullProtections,
      });

      expect(projects).toEqual([{ id: "A", lwqlKey: "key-A" }]);
      expect(permissions.apiKeyProjectCuts).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization API key", () => {
  const candidates = [
    { id: "A", lwqlKey: "key-A", teamId: "tA" },
    { id: "B", lwqlKey: "key-B", teamId: "tB" },
    { id: "C", lwqlKey: "key-C", teamId: "tC" },
  ];

  describe("when it grants analytics:view on several projects", () => {
    /** @scenario "The query door resolves any key to its readable-project scope" */
    it("passes the union of exactly those projects", async () => {
      const { projects } = await resolveLwqlQueryScope({
        principal: apiKeyPrincipal,
        permissions: fakePermissions(new Set(["A", "B"])),
        prisma: fakePrisma(candidates),
        protectionsFor: async () => fullProtections,
      });

      expect(projects.map((p) => p.id).sort()).toEqual(["A", "B"]);
    });

    it("excludes a project whose analytics:view is withheld", async () => {
      const { projects } = await resolveLwqlQueryScope({
        principal: apiKeyPrincipal,
        permissions: fakePermissions(new Set(["A"])),
        prisma: fakePrisma(candidates),
        protectionsFor: async () => fullProtections,
      });

      expect(projects.map((p) => p.id)).toEqual(["A"]);
    });
  });

  describe("when it grants analytics:view on exactly one project", () => {
    it("passes that one project", async () => {
      const { projects } = await resolveLwqlQueryScope({
        principal: apiKeyPrincipal,
        permissions: fakePermissions(new Set(["B"])),
        prisma: fakePrisma(candidates),
        protectionsFor: async () => fullProtections,
      });

      expect(projects.map((p) => p.id)).toEqual(["B"]);
    });
  });

  describe("when it can read no project", () => {
    it("passes an empty scope rather than refusing", async () => {
      const { projects } = await resolveLwqlQueryScope({
        principal: apiKeyPrincipal,
        permissions: fakePermissions(new Set()),
        prisma: fakePrisma(candidates),
        protectionsFor: async () => fullProtections,
      });

      expect(projects).toEqual([]);
    });
  });
});

describe("given projects with differing content protections", () => {
  const candidates = [
    { id: "A", lwqlKey: "key-A", teamId: "tA" },
    { id: "B", lwqlKey: "key-B", teamId: "tB" },
  ];
  const perProject: Record<string, Protections> = {
    A: {
      canSeeCosts: true,
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
    },
    B: {
      canSeeCosts: true,
      canSeeCapturedInput: false,
      canSeeCapturedOutput: true,
    },
  };

  describe("when the caller reads both", () => {
    /** @scenario "The query door redacts content to the strictest protection across the readable set" */
    it("offers a category only when every readable project grants it", async () => {
      const { protections } = await resolveLwqlQueryScope({
        principal: apiKeyPrincipal,
        permissions: fakePermissions(new Set(["A", "B"])),
        prisma: fakePrisma(candidates),
        protectionsFor: async (id) => perProject[id]!,
      });

      expect(protections.canSeeCosts).toBe(true);
      expect(protections.canSeeCapturedOutput).toBe(true);
      // B cannot see captured input, so the strictest set cannot either.
      expect(protections.canSeeCapturedInput).toBe(false);
    });
  });
});

describe("strictestLwqlProtections", () => {
  describe("when the set is empty", () => {
    it("offers no content", () => {
      expect(strictestLwqlProtections([])).toEqual({
        canSeeCosts: false,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
      });
    });
  });

  describe("when one project withholds a flag", () => {
    it("ANDs the flag to false across the set", () => {
      const merged = strictestLwqlProtections([
        {
          canSeeCosts: true,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
        },
        {
          canSeeCosts: false,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
        },
      ]);
      expect(merged.canSeeCosts).toBe(false);
      expect(merged.canSeeCapturedInput).toBe(true);
    });
  });
});
