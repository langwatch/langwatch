import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { RoleBindingScopeType } from "~/generated/prisma/client";
import {
  generateApiKeyToken,
  hashSecret,
  splitApiKeyToken,
} from "../api-key-token.utils";
import { TokenResolver } from "../token-resolver";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const ORG = "org_1";
const OTHER_ORG = "org_2";

const boundProject = {
  id: "project_bound",
  apiKey: null,
  archivedAt: null,
  team: { id: "team_1", organizationId: ORG },
};

/** A sibling in the SAME organization the key holds no binding for. */
const siblingProject = {
  id: "project_sibling",
  apiKey: null,
  archivedAt: null,
  team: { id: "team_2", organizationId: ORG },
};

const foreignProject = {
  id: "project_foreign",
  apiKey: null,
  archivedAt: null,
  team: { id: "team_9", organizationId: OTHER_ORG },
};

const PROJECTS = [boundProject, siblingProject, foreignProject];

type Binding = { scopeType: RoleBindingScopeType; scopeId: string };

/**
 * A prisma double that answers the two reads resolution makes: the ApiKey
 * behind the token, and the project it names. The token is hashed the way
 * the service hashes it, so `verify` takes its real path rather than being
 * stubbed past.
 */
function createMockPrisma({
  token,
  roleBindings,
}: {
  token: string;
  roleBindings: Binding[];
}) {
  const parts = splitApiKeyToken(token);
  const apiKeyRow = {
    id: "apikey_1",
    name: "test key",
    lookupId: parts!.lookupId,
    hashedSecret: hashSecret(parts!.secret),
    organizationId: ORG,
    userId: "user_1",
    revokedAt: null,
    expiresAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: new Date("2020-01-01"),
    roleBindings,
  };

  return {
    project: {
      findUnique: vi.fn(({ where }: { where: { id?: string } }) =>
        Promise.resolve(PROJECTS.find((p) => p.id === where.id) ?? null),
      ),
    },
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(apiKeyRow),
      findFirst: vi.fn().mockResolvedValue(apiKeyRow),
      update: vi.fn(),
    },
  } as unknown as PrismaClient;
}

function resolverFor(roleBindings: Binding[]) {
  const { token } = generateApiKeyToken();
  const prisma = createMockPrisma({ token, roleBindings });
  return { token, resolver: TokenResolver.create(prisma) };
}

const projectBinding = (scopeId: string): Binding => ({
  scopeType: RoleBindingScopeType.PROJECT,
  scopeId,
});

describe("TokenResolver project pinning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a key bound to one project", () => {
    describe("when it names a different project of the same organization", () => {
      /** @scenario "A key naming a project it holds no binding for is refused" */
      it("refuses rather than resolving to the named project", async () => {
        const { token, resolver } = resolverFor([
          projectBinding(boundProject.id),
        ]);

        const outcome = await resolver.resolveProject({
          token,
          projectId: siblingProject.id,
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok === false && outcome.reason).toBe(
          "project_not_covered",
        );
      });
    });

    describe("when it names the project it is bound to", () => {
      it("resolves to that project", async () => {
        const { token, resolver } = resolverFor([
          projectBinding(boundProject.id),
        ]);

        const outcome = await resolver.resolveProject({
          token,
          projectId: boundProject.id,
        });

        expect(outcome.ok).toBe(true);
        expect(outcome.ok === true && outcome.resolved.project.id).toBe(
          boundProject.id,
        );
      });
    });

    describe("when it sends no project header", () => {
      /** @scenario "A key bound to exactly one project needs no header" */
      it("resolves to its single project", async () => {
        const { token, resolver } = resolverFor([
          projectBinding(boundProject.id),
        ]);

        const outcome = await resolver.resolveProject({ token });

        expect(outcome.ok).toBe(true);
        expect(outcome.ok === true && outcome.resolved.project.id).toBe(
          boundProject.id,
        );
      });
    });
  });

  describe("given a key bound at team scope", () => {
    describe("when it names a project of that team", () => {
      it("resolves, because a team binding covers its projects", async () => {
        const { token, resolver } = resolverFor([
          { scopeType: RoleBindingScopeType.TEAM, scopeId: "team_1" },
        ]);

        const outcome = await resolver.resolveProject({
          token,
          projectId: boundProject.id,
        });

        expect(outcome.ok).toBe(true);
      });
    });

    describe("when it names a project of another team", () => {
      it("refuses", async () => {
        const { token, resolver } = resolverFor([
          { scopeType: RoleBindingScopeType.TEAM, scopeId: "team_1" },
        ]);

        const outcome = await resolver.resolveProject({
          token,
          projectId: siblingProject.id,
        });

        expect(outcome.ok === false && outcome.reason).toBe(
          "project_not_covered",
        );
      });
    });
  });

  describe("given a key bound at organization scope", () => {
    /** @scenario "An organization-scoped key reaches any project it covers" */
    it("reaches any project of that organization", async () => {
      const { token, resolver } = resolverFor([
        { scopeType: RoleBindingScopeType.ORGANIZATION, scopeId: ORG },
      ]);

      const outcome = await resolver.resolveProject({
        token,
        projectId: siblingProject.id,
      });

      expect(outcome.ok).toBe(true);
    });
  });

  describe("given a key carrying no bindings at all", () => {
    it("keeps its organization-wide reach", async () => {
      // The legacy population the read-through mint grants organization ADMIN
      // to, plus ingestion keys — neither has a narrower grant to exceed.
      const { token, resolver } = resolverFor([]);

      const outcome = await resolver.resolveProject({
        token,
        projectId: siblingProject.id,
      });

      expect(outcome.ok).toBe(true);
    });
  });

  describe("given a key covering several projects", () => {
    describe("when it sends no project header", () => {
      /** @scenario "A key covering several projects is told to name one" */
      it("says the request must name a project", async () => {
        const { token, resolver } = resolverFor([
          projectBinding(boundProject.id),
          projectBinding(siblingProject.id),
        ]);

        const outcome = await resolver.resolveProject({ token });

        expect(outcome.ok === false && outcome.reason).toBe(
          "project_ambiguous",
        );
      });
    });
  });

  describe("given any key", () => {
    describe("when it names a project outside its organization", () => {
      /** @scenario "A key naming a project of another organization is refused" */
      it("refuses generically, without confirming the project exists", async () => {
        const { token, resolver } = resolverFor([
          { scopeType: RoleBindingScopeType.ORGANIZATION, scopeId: ORG },
        ]);

        const outcome = await resolver.resolveProject({
          token,
          projectId: foreignProject.id,
        });

        expect(outcome.ok === false && outcome.reason).toBe(
          "unusable_credential",
        );
      });
    });

    describe("when it sends an empty project header", () => {
      /** @scenario "An empty project header is a caller error, not a server fault" */
      it("falls back to its own single binding rather than failing", async () => {
        const { token, resolver } = resolverFor([
          projectBinding(boundProject.id),
        ]);

        const outcome = await resolver.resolveProject({
          token,
          projectId: "",
        });

        expect(outcome.ok).toBe(true);
        expect(outcome.ok === true && outcome.resolved.project.id).toBe(
          boundProject.id,
        );
      });
    });
  });
});
