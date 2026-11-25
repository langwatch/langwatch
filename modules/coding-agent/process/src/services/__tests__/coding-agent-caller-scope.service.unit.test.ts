import { describe, expect, it } from "vitest";

import { CodingAgentCallerScopeService } from "../coding-agent-caller-scope.service.ts";
import type {
  CodingAgentCallerScopeDirectory,
  CodingAgentScopeProject,
} from "../coding-agent-scope-directory.service.ts";
import type { CodingAgentScopePermissions } from "../coding-agent-scope-permissions.service.ts";

const caller = { kind: "user", userId: "user-1" } as const;

class FakeDirectory implements CodingAgentCallerScopeDirectory {
  projects: readonly CodingAgentScopeProject[] = [];
  ownerNames = new Map<string, string>();
  listPersonalTeamOwnerNamesCalls: readonly string[][] = [];

  listOrganizationProjects(): Promise<readonly CodingAgentScopeProject[]> {
    return Promise.resolve(this.projects);
  }

  listPersonalTeamOwnerNames(input: {
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    this.listPersonalTeamOwnerNamesCalls = [
      ...this.listPersonalTeamOwnerNamesCalls,
      [...input.teamIds],
    ];
    return Promise.resolve(this.ownerNames);
  }
}

class AllowAllPermissions implements CodingAgentScopePermissions {
  projectCuts(input: {
    caller:
      | { kind: "user"; userId: string }
      | { kind: "apiKey"; apiKeyId: string; userId: string | null };
    organizationId: string;
    projects: readonly CodingAgentScopeProject[];
    permissions: readonly ("traces:view" | "cost:view")[];
  }) {
    const ids = new Set(input.projects.map((project) => project.id));
    return Promise.resolve(new Map([["traces:view", ids] as const, ["cost:view", ids] as const]));
  }
}

function service(directory: FakeDirectory) {
  return CodingAgentCallerScopeService.create({
    directory,
    permissions: new AllowAllPermissions(),
  });
}

describe("given a caller resolving their reach across an organization's projects", () => {
  describe("when a permitted project is a personal workspace with an owner name", () => {
    /** @scenario "A personal workspace resolves to the person who owns it" */
    it("labels it by the person who owns it", async () => {
      const directory = new FakeDirectory();
      directory.projects = [
        { id: "p1", name: "Ada's workspace", slug: "ada", teamId: "team-1", isPersonal: true },
      ];
      directory.ownerNames = new Map([["team-1", "Ada Lovelace"]]);

      const scope = await service(directory).resolve({ caller, organizationId: "org-1" });

      expect(scope.projects.p1).toMatchObject({
        contributorLabel: "Ada Lovelace",
        isLinkable: false,
      });
    });
  });

  describe("when a personal workspace has no member to name it after", () => {
    /** @scenario "A personal workspace nobody is a member of keeps its own name" */
    it("keeps the workspace's own name", async () => {
      const directory = new FakeDirectory();
      directory.projects = [
        {
          id: "p1",
          name: "Orphaned workspace",
          slug: "orphaned",
          teamId: "team-1",
          isPersonal: true,
        },
      ];
      directory.ownerNames = new Map();

      const scope = await service(directory).resolve({ caller, organizationId: "org-1" });

      expect(scope.projects.p1?.contributorLabel).toBe("Orphaned workspace");
    });
  });

  describe("when the organization has both personal and shared projects", () => {
    /** @scenario "Members are read for personal teams alone" */
    it("asks for owner names only for the personal teams", async () => {
      const directory = new FakeDirectory();
      directory.projects = [
        { id: "p1", name: "Ada's workspace", slug: "ada", teamId: "team-1", isPersonal: true },
        { id: "p2", name: "Shared", slug: "shared", teamId: "team-2", isPersonal: false },
      ];

      await service(directory).resolve({ caller, organizationId: "org-1" });

      expect(directory.listPersonalTeamOwnerNamesCalls).toEqual([["team-1"]]);
    });
  });
});

type ScopeCaller = Parameters<CodingAgentScopePermissions["projectCuts"]>[0]["caller"];

/** Grants by the credential itself: what a key's own bindings allow, whoever holds it. */
class KeyBindingPermissions implements CodingAgentScopePermissions {
  readonly askedFor: ScopeCaller[] = [];

  constructor(
    private readonly bindings: { viewable: readonly string[]; priceable: readonly string[] },
  ) {}

  projectCuts(input: { caller: ScopeCaller }) {
    this.askedFor.push(input.caller);
    return Promise.resolve(
      new Map([
        ["traces:view", new Set(this.bindings.viewable)] as const,
        ["cost:view", new Set(this.bindings.priceable)] as const,
      ]),
    );
  }
}

function scopeUnderBindings(bindings: ConstructorParameters<typeof KeyBindingPermissions>[0]): {
  scope: CodingAgentCallerScopeService;
  permissions: KeyBindingPermissions;
} {
  const directory = new FakeDirectory();
  directory.projects = [
    { id: "p1", name: "One", slug: "one", teamId: "team-1", isPersonal: false },
    { id: "p2", name: "Two", slug: "two", teamId: "team-2", isPersonal: false },
  ];
  const permissions = new KeyBindingPermissions(bindings);
  return { scope: CodingAgentCallerScopeService.create({ directory, permissions }), permissions };
}

const organizationKey = { kind: "apiKey", apiKeyId: "key-1", userId: "user-1" } as const;
const serviceKey = { kind: "apiKey", apiKeyId: "key-2", userId: null } as const;

describe("given an organization key reading across the organization's projects", () => {
  describe("when the key is bound to fewer projects than its holder may view", () => {
    /** @scenario "A narrowed key reads with its own scope, not its holder's" */
    it("names the key as the principal and admits only the bound project", async () => {
      const { scope, permissions } = scopeUnderBindings({ viewable: ["p1"], priceable: ["p1"] });

      const resolved = await scope.resolve({ caller: organizationKey, organizationId: "org-1" });

      expect(permissions.askedFor).toEqual([organizationKey]);
      expect(resolved.permittedProjectIds).toEqual(["p1"]);
      expect(Object.keys(resolved.projects)).toEqual(["p1"]);
    });
  });

  describe("when the binding lacks the cost grant", () => {
    /** @scenario "A key whose binding lacks the cost grant reads tokens with no cost" */
    it("permits the project for tokens and prices none of it", async () => {
      const { scope } = scopeUnderBindings({ viewable: ["p1"], priceable: [] });

      const resolved = await scope.resolve({ caller: organizationKey, organizationId: "org-1" });

      expect(resolved.permittedProjectIds).toEqual(["p1"]);
      expect(resolved.costProjectIds).toEqual([]);
    });
  });
});

describe("given a service key that acts as nobody", () => {
  describe("when its bindings are organization-wide", () => {
    /** @scenario "An organization service key reads the rollup scoped by its own bindings" */
    it("covers every project the bindings may view, on its own identity", async () => {
      const { scope, permissions } = scopeUnderBindings({
        viewable: ["p1", "p2"],
        priceable: ["p1", "p2"],
      });

      const resolved = await scope.resolve({ caller: serviceKey, organizationId: "org-1" });

      expect(permissions.askedFor).toEqual([serviceKey]);
      expect(resolved.permittedProjectIds).toEqual(["p1", "p2"]);
      expect(resolved.costProjectIds).toEqual(["p1", "p2"]);
    });
  });

  describe("when its bindings grant viewing but not pricing", () => {
    /** @scenario "A service key without the cost grant reads tokens with every cost null" */
    it("permits every viewable project and prices none", async () => {
      const { scope } = scopeUnderBindings({ viewable: ["p1", "p2"], priceable: [] });

      const resolved = await scope.resolve({ caller: serviceKey, organizationId: "org-1" });

      expect(resolved.permittedProjectIds).toEqual(["p1", "p2"]);
      expect(resolved.costProjectIds).toEqual([]);
    });
  });

  describe("when it is bound to one project", () => {
    /** @scenario "A service key bound to one project sees only that project's rows" */
    it("leaves the other project out of the whole scope", async () => {
      const { scope } = scopeUnderBindings({ viewable: ["p2"], priceable: ["p2"] });

      const resolved = await scope.resolve({ caller: serviceKey, organizationId: "org-1" });

      expect(resolved.permittedProjectIds).toEqual(["p2"]);
      expect(resolved.costProjectIds).toEqual(["p2"]);
      expect(Object.keys(resolved.projects)).toEqual(["p2"]);
    });
  });
});
