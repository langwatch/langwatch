/**
 * What the v1 pull-request rollup lets one CREDENTIAL see.
 * Spec: specs/coding-agent/pull-request-linkage.feature
 */
import { AuthzService, type AuthzServiceOptions } from "@langwatch/authz-server";
import type { CollectedBinding } from "@langwatch/authz-contract";
import {
  CodingAgentCallerScopeDirectoryPort,
  CodingAgentCallerScopeService,
  type CodingAgentScopeProject,
} from "@langwatch/coding-agent-server";
import { describe, expect, it, vi } from "vitest";

import {
  ApiCodingAgentScopeDirectory,
  ApiCodingAgentScopePermissions,
} from "../../features/coding-agent/coding-agent.composition";

const ORGANIZATION = "organization-1";
const KEY = "key-1";
const HOLDER = "user-1";

const BOUND: CodingAgentScopeProject = {
  id: "project-bound",
  name: "Bound",
  slug: "bound",
  teamId: "team-bound",
  isPersonal: false,
};
const OTHER: CodingAgentScopeProject = {
  id: "project-other",
  name: "Other",
  slug: "other",
  teamId: "team-other",
  isPersonal: false,
};

const binding = (
  role: CollectedBinding["role"],
  scopeId: string,
  scopeType: CollectedBinding["scopeType"] = "PROJECT",
): CollectedBinding => ({
  role,
  customRoleId: null,
  scopeType,
  scopeId,
  viaGroupId: null,
});

type Reader = AuthzServiceOptions["repository"];

/** Every read empty; a scenario turns on only what it is about. */
function reader(overrides: Partial<Reader> = {}): Reader {
  return {
    tryFindOrganizationMembership: vi.fn().mockResolvedValue(null),
    findUserBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    tryFindApiKeyOwner: vi.fn().mockResolvedValue(null),
    findLegacyTeamMemberships: vi.fn().mockResolvedValue([]),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    tryFindProjectLineage: vi.fn().mockResolvedValue(null),
    tryFindTeamOrganization: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as Reader;
}

/** The organization's two projects, and no personal workspace among them. */
class TwoProjectDirectory extends CodingAgentCallerScopeDirectoryPort {
  async listOrganizationProjects(): Promise<readonly CodingAgentScopeProject[]> {
    return [BOUND, OTHER];
  }

  async listPersonalTeamOwnerNames(): Promise<ReadonlyMap<string, string>> {
    return new Map();
  }
}

function scopeFor(overrides: Partial<Reader>): CodingAgentCallerScopeService {
  const authz = AuthzService.create({
    isOnEngine: async () => true,
    repository: reader(overrides),
    listing: { findUserBindings: async () => [] } as never,
    bindings: {} as never,
  });
  return CodingAgentCallerScopeService.create({
    directory: new TwoProjectDirectory(),
    permissions: new ApiCodingAgentScopePermissions(authz),
  });
}

const asKey = (userId: string | null) => ({ kind: "apiKey", apiKeyId: KEY, userId }) as const;

describe("given a user-bound key narrower than its holder", () => {
  describe("when the organization-wide cut is resolved", () => {
    /** @scenario "A narrowed key reads with its own scope, not its holder's" */
    it("answers the key's project, never the holder's other one", async () => {
      const scope = await scopeFor({
        tryFindApiKeyOwner: vi.fn().mockResolvedValue({ userId: HOLDER }),
        findApiKeyBindings: vi.fn().mockResolvedValue([binding("ADMIN", BOUND.id)]),
        tryFindOrganizationMembership: vi
          .fn()
          .mockResolvedValue({ role: "MEMBER", disabled: false }),
        findUserBindings: vi
          .fn()
          .mockResolvedValue([binding("ADMIN", BOUND.id), binding("ADMIN", OTHER.id)]),
      }).resolve({ caller: asKey(HOLDER), organizationId: ORGANIZATION });

      expect(scope.permittedProjectIds).toEqual([BOUND.id]);
      // Absent from the whole answer, not merely from the rows: a name the
      // caller may not read must not travel with the rollup either.
      expect(Object.keys(scope.projects)).toEqual([BOUND.id]);
    });
  });
});

describe("given a key bound to a role that cannot price", () => {
  describe("when the organization-wide cut is resolved", () => {
    /** @scenario "A key whose binding lacks the cost grant reads tokens with no cost" */
    it("permits the project to be read and none to be priced", async () => {
      const scope = await scopeFor({
        tryFindApiKeyOwner: vi.fn().mockResolvedValue({ userId: HOLDER }),
        findApiKeyBindings: vi.fn().mockResolvedValue([binding("VIEWER", BOUND.id)]),
        tryFindOrganizationMembership: vi
          .fn()
          .mockResolvedValue({ role: "MEMBER", disabled: false }),
        findUserBindings: vi.fn().mockResolvedValue([binding("ADMIN", BOUND.id)]),
      }).resolve({ caller: asKey(HOLDER), organizationId: ORGANIZATION });

      expect(scope.permittedProjectIds).toEqual([BOUND.id]);
      expect(scope.costProjectIds).toEqual([]);
    });
  });
});

describe("given an organization service key, which acts as nobody", () => {
  describe("when it is bound organization-wide", () => {
    /** @scenario "An organization service key reads the rollup scoped by its own bindings" */
    it("covers every project those bindings may view", async () => {
      const scope = await scopeFor({
        findApiKeyBindings: vi
          .fn()
          .mockResolvedValue([binding("ADMIN", ORGANIZATION, "ORGANIZATION")]),
      }).resolve({ caller: asKey(null), organizationId: ORGANIZATION });

      expect(scope.permittedProjectIds).toEqual([BOUND.id, OTHER.id]);
      expect(scope.costProjectIds).toEqual([BOUND.id, OTHER.id]);
    });
  });

  describe("when its bindings grant viewing but not pricing", () => {
    // Stated at PROJECT scope because that is the only place it can be
    // stated: an organization-scoped binding that is not ADMIN grants the
    // organization-member bag alone (ADR-021), which carries no `traces:view`
    // at all - so an org-scoped VIEWER would prove the rows absent rather
    // than their cost absent.
    /** @scenario "A service key without the cost grant reads tokens with every cost null" */
    it("permits every project to be read and none to be priced", async () => {
      const scope = await scopeFor({
        findApiKeyBindings: vi
          .fn()
          .mockResolvedValue([binding("VIEWER", BOUND.id), binding("VIEWER", OTHER.id)]),
      }).resolve({ caller: asKey(null), organizationId: ORGANIZATION });

      expect(scope.permittedProjectIds).toEqual([BOUND.id, OTHER.id]);
      expect(scope.costProjectIds).toEqual([]);
    });
  });

  describe("when it is bound to one project of the organization", () => {
    /** @scenario "A service key bound to one project sees only that project's rows" */
    it("answers that project alone", async () => {
      const scope = await scopeFor({
        findApiKeyBindings: vi.fn().mockResolvedValue([binding("ADMIN", BOUND.id)]),
      }).resolve({ caller: asKey(null), organizationId: ORGANIZATION });

      expect(scope.permittedProjectIds).toEqual([BOUND.id]);
      expect(Object.keys(scope.projects)).toEqual([BOUND.id]);
    });
  });
});

describe("given personal-workspace membership rows read from Postgres", () => {
  describe("when a member has no display name set", () => {
    /** @scenario "A person with no display name is named by their email address" */
    it("names them by their email address", async () => {
      const findMany = vi
        .fn()
        .mockResolvedValue([{ teamId: "team-1", user: { name: null, email: "ada@example.com" } }]);
      const directory = new ApiCodingAgentScopeDirectory({ teamUser: { findMany } } as never);

      const names = await directory.listPersonalTeamOwnerNames({ teamIds: ["team-1"] });

      expect(names.get("team-1")).toBe("ada@example.com");
    });
  });

  describe("when a membership row's user has since been deleted", () => {
    /** @scenario "A membership row that outlives its user still resolves the scope" */
    it("names nothing for that row rather than failing the read", async () => {
      const findMany = vi.fn().mockResolvedValue([{ teamId: "team-1", user: null }]);
      const directory = new ApiCodingAgentScopeDirectory({ teamUser: { findMany } } as never);

      const names = await directory.listPersonalTeamOwnerNames({ teamIds: ["team-1"] });

      expect(names.has("team-1")).toBe(false);
    });
  });
});
