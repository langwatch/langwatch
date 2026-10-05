import type { CollectedBinding } from "@langwatch/authz";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzCollectorService } from "../authz-collector.service";
import type { AuthzReadRepository } from "../authz-read.repository";
import { makeReader } from "./support/authz-read.stub";

const { warn, debug, info } = vi.hoisted(() => ({
  warn: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn, debug, info, error: vi.fn() }),
}));

import { type AuthzForkOptions, AuthzForkService } from "../authz-fork.service";

const ORG = "org-1";
const TEAM = "team-1";
const PROJECT = "proj-1";
const LINEAGE = { teamId: TEAM, organizationId: ORG };

const projectBinding = (role: CollectedBinding["role"]): CollectedBinding[] => [
  {
    role,
    customRoleId: null,
    scopeType: "PROJECT",
    scopeId: PROJECT,
    viaGroupId: null,
  },
];

const teamBinding = (role: CollectedBinding["role"]): CollectedBinding[] => [
  {
    role,
    customRoleId: null,
    scopeType: "TEAM",
    scopeId: TEAM,
    viaGroupId: null,
  },
];

function makeForkReader(overrides: Partial<AuthzReadRepository> = {}) {
  return makeReader({
    findProjectLineage: vi.fn().mockResolvedValue(LINEAGE),
    findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
    ...overrides,
  });
}

function makeFork(
  reader: AuthzReadRepository,
  options: Partial<AuthzForkOptions> = {},
) {
  return new AuthzForkService(new AuthzCollectorService(reader), {
    demoProjectId: () => undefined,
    ...options,
  });
}

/** A member whose PROJECT binding grants everything at that project. */
const memberWithProjectAdmin = (overrides: Partial<AuthzReadRepository> = {}) =>
  makeForkReader({
    findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
    findUserBindings: vi.fn().mockResolvedValue(projectBinding("ADMIN")),
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  AuthzForkService.resetRateAnnouncement();
});

describe("the authz fork", () => {
  describe("given a cut-over organization", () => {
    /** @scenario "A cut-over organization is decided by the engine" */
    it("returns the engine's answer without waiting for legacy", async () => {
      let releaseLegacy: (allowed: boolean) => void = () => undefined;
      const legacy = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            releaseLegacy = resolve;
          }),
      );
      const fork = makeFork(memberWithProjectAdmin());

      const decision = await fork.decideUserPermission({
        userId: "alice",
        permission: "traces:view",
        projectId: PROJECT,
        caller: "trpc.project",
        legacy,
      });

      // The legacy resolver has not answered yet and never needed to: the
      // engine's verdict is the one the caller is holding.
      expect(decision).toEqual({ allowed: true, organizationRole: "MEMBER" });
      expect(legacy).toHaveBeenCalledTimes(1);
      releaseLegacy(true);
      await vi.waitFor(() =>
        expect(debug).toHaveBeenCalledWith(
          expect.objectContaining({
            caller: "trpc.project",
            permission: "traces:view",
            legacyAllowed: true,
            engineAllowed: true,
            primary: "engine",
          }),
          "authz fork match",
        ),
      );
      expect(warn).not.toHaveBeenCalled();
    });

    describe("when legacy would have answered differently", () => {
      /** @scenario "Legacy runs behind the engine as the reverse-shadow comparison" */
      it("keeps the engine's answer and logs the mismatch", async () => {
        const fork = makeFork(memberWithProjectAdmin());

        const decision = await fork.decideUserPermission({
          userId: "alice",
          permission: "traces:view",
          projectId: PROJECT,
          caller: "trpc.project",
          legacy: async () => false,
        });

        expect(decision.allowed).toBe(true);
        await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            legacyAllowed: false,
            engineAllowed: true,
            scopeType: "project",
            scopeId: PROJECT,
            principalType: "user",
            primary: "engine",
          }),
          "authz fork mismatch",
        );
      });
    });

    describe("when the legacy resolver throws", () => {
      it("logs the failed comparison and leaves the answer alone", async () => {
        const fork = makeFork(memberWithProjectAdmin());

        const decision = await fork.decideUserPermission({
          userId: "alice",
          permission: "traces:view",
          projectId: PROJECT,
          caller: "trpc.project",
          legacy: async () => {
            throw new Error("transaction already closed");
          },
        });

        expect(decision.allowed).toBe(true);
        await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ caller: "trpc.project" }),
          "authz fork comparison failed",
        );
      });
    });

    describe("when the caller opts out of the comparison", () => {
      it("skips the comparison and still decides", async () => {
        const legacy = vi.fn(async () => false);
        const fork = makeFork(memberWithProjectAdmin());

        const decision = await fork.decideUserPermission({
          userId: "alice",
          permission: "traces:view",
          projectId: PROJECT,
          caller: "apiKeyPath.userBindings",
          legacy,
          compare: false,
        });
        await new Promise((resolve) => setImmediate(resolve));

        expect(decision.allowed).toBe(true);
        expect(legacy).not.toHaveBeenCalled();
        expect(debug).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
      });
    });

    describe("when the scope does not resolve", () => {
      it("denies, and files the unresolved outcome against legacy", async () => {
        const fork = makeFork(
          makeForkReader({
            findProjectLineage: vi.fn().mockResolvedValue(null),
          }),
        );

        const decision = await fork.decideUserPermission({
          userId: "alice",
          permission: "traces:view",
          projectId: "proj-ghost",
          caller: "trpc.project",
          legacy: async () => true,
        });

        expect(decision).toEqual({ allowed: false, organizationRole: null });
        await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            scopeType: "unresolved",
            engineAllowed: false,
            legacyAllowed: true,
          }),
          "authz fork mismatch",
        );
      });
    });
  });

  describe("given several candidate permissions", () => {
    it("stops at the first the caller holds, in the order given", async () => {
      const fork = makeFork(
        memberWithProjectAdmin({
          // VIEWER at the project: `traces:view` lands, `datasets:manage`
          // does not.
          findUserBindings: vi.fn().mockResolvedValue(projectBinding("VIEWER")),
        }),
      );

      const decision = await fork.decideUserPermissionsAny({
        userId: "alice",
        permissions: ["datasets:manage", "traces:view", "project:view"],
        projectId: PROJECT,
        caller: "trpc.projectAny",
        legacy: async () => ({ allowed: true }),
      });

      expect(decision).toEqual({
        allowed: true,
        matchedPermission: "traces:view",
        organizationRole: "MEMBER",
      });
      await vi.waitFor(() =>
        expect(debug).toHaveBeenCalledWith(
          expect.objectContaining({
            // The candidate that settled it is the one the comparison names.
            permission: "traces:view",
            engineAllowed: true,
            legacyAllowed: true,
          }),
          "authz fork match",
        ),
      );
    });

    describe("when the caller holds none of them", () => {
      it("denies and names the whole list in the comparison", async () => {
        const fork = makeFork(
          makeForkReader({
            findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
          }),
        );

        const decision = await fork.decideUserPermissionsAny({
          userId: "alice",
          permissions: ["datasets:manage", "traces:manage"],
          projectId: PROJECT,
          caller: "trpc.projectAny",
          legacy: async () => ({ allowed: false }),
        });

        expect(decision.allowed).toBe(false);
        expect(decision.matchedPermission).toBeUndefined();
        await vi.waitFor(() =>
          expect(debug).toHaveBeenCalledWith(
            expect.objectContaining({
              permission: "datasets:manage | traces:manage",
              engineAllowed: false,
              legacyAllowed: false,
            }),
            "authz fork match",
          ),
        );
      });
    });
  });

  describe("given a batch of scopes in one organization", () => {
    it("collects once and decides each scope against that snapshot", async () => {
      const reader = makeForkReader({
        findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
        findUserBindings: vi.fn().mockResolvedValue(teamBinding("ADMIN")),
      });
      const fork = makeFork(reader);

      const decision = await fork.decideUserBatchPermissions({
        userId: "alice",
        permission: "traces:view",
        organizationId: ORG,
        teams: [{ teamId: TEAM }, { teamId: "team-2" }],
        projects: [
          { projectId: PROJECT, teamId: TEAM },
          { projectId: "proj-2", teamId: "team-2" },
        ],
        caller: "trpc.batch",
        legacy: async () => ({
          teams: new Map([
            [TEAM, true],
            ["team-2", false],
          ]),
          projects: new Map([
            [PROJECT, true],
            ["proj-2", true],
          ]),
        }),
      });

      // The team binding covers its own team and the project under it, and
      // nothing else.
      expect([...decision.teams]).toEqual([
        [TEAM, true],
        ["team-2", false],
      ]);
      expect([...decision.projects]).toEqual([
        [PROJECT, true],
        ["proj-2", false],
      ]);
      expect(decision.organizationRole).toBe("MEMBER");
      // One collection for four scopes, and the supplied lineage meant no
      // per-project resolution query at all.
      expect(reader.findOrganizationRole).toHaveBeenCalledTimes(1);
      expect(reader.findProjectLineage).not.toHaveBeenCalled();

      // Three verdicts agree with legacy, the fourth does not.
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: "project",
          scopeId: "proj-2",
          legacyAllowed: true,
          engineAllowed: false,
          primary: "engine",
        }),
        "authz fork mismatch",
      );
      expect(debug).toHaveBeenCalledTimes(3);
    });

    describe("when a project's team is unknown to the caller", () => {
      it("resolves that one scope and denies an unresolvable one", async () => {
        const reader = makeForkReader({
          findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
          findUserBindings: vi.fn().mockResolvedValue(teamBinding("ADMIN")),
          findProjectLineage: vi
            .fn()
            .mockResolvedValueOnce(LINEAGE)
            .mockResolvedValueOnce(null),
        });
        const fork = makeFork(reader);

        const decision = await fork.decideUserBatchPermissions({
          userId: "alice",
          permission: "traces:view",
          organizationId: ORG,
          teams: [],
          projects: [{ projectId: PROJECT }, { projectId: "proj-ghost" }],
          caller: "trpc.batch",
          legacy: async () => ({ teams: new Map(), projects: new Map() }),
          compare: false,
        });

        expect([...decision.projects]).toEqual([
          [PROJECT, true],
          ["proj-ghost", false],
        ]);
        expect(reader.findProjectLineage).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given a named principal with no owner ceiling", () => {
    it("decides on that principal's own grants alone", async () => {
      const reader = makeForkReader({
        findApiKeyBindings: vi.fn().mockResolvedValue(projectBinding("ADMIN")),
        // An owner who holds nothing: irrelevant here by contract, and the
        // read never happens.
        findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
      });
      const fork = makeFork(reader);

      const allowed = await fork.decidePrincipalPermission({
        principal: { type: "apiKey", id: "key-1" },
        organizationId: ORG,
        projectId: PROJECT,
        permission: "datasets:manage",
        caller: "apiKeyPath.keyBindings",
        legacy: async () => true,
      });

      expect(allowed).toBe(true);
      expect(reader.findUserBindings).not.toHaveBeenCalled();
    });

    describe("when the scope is the organization itself", () => {
      it("asks at the organization, not at a project", async () => {
        const reader = makeForkReader();
        const fork = makeFork(reader);

        await fork.decidePrincipalPermission({
          principal: { type: "user", id: "alice" },
          organizationId: ORG,
          permission: "organization:view",
          caller: "apiKeyPath.userBindings",
          legacy: async () => false,
          compare: false,
        });

        expect(reader.findProjectLineage).not.toHaveBeenCalled();
        expect(reader.findTeamOrganization).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an api key whose owner has been downgraded", () => {
    /** @scenario "An API key is capped by its owner's current grants" */
    it("applies the owner ceiling to the key's own grant", async () => {
      const fork = makeFork(
        makeForkReader({
          findApiKeyBindings: vi
            .fn()
            .mockResolvedValue(projectBinding("ADMIN")),
          findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
          // The owner holds nothing at this project any more.
          findUserBindings: vi.fn().mockResolvedValue([]),
        }),
      );

      const allowed = await fork.decideApiKeyPermission({
        apiKeyId: "key-1",
        ownerUserId: "dave",
        organizationId: ORG,
        projectId: PROJECT,
        permission: "datasets:manage",
        caller: "apiKeyPath.ceiling",
        legacy: async () => true,
      });

      expect(allowed).toBe(false);
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          denialReason: "owner-ceiling",
          legacyAllowed: true,
          engineAllowed: false,
          primary: "engine",
        }),
        "authz fork mismatch",
      );
    });

    describe("when the owner is a lite member", () => {
      it("tags the closed escalation as a known divergence", async () => {
        const fork = makeFork(
          makeForkReader({
            findApiKeyBindings: vi
              .fn()
              .mockResolvedValue(projectBinding("ADMIN")),
            findOrganizationRole: vi.fn().mockResolvedValue("EXTERNAL"),
            findUserBindings: vi
              .fn()
              .mockResolvedValue(projectBinding("MEMBER")),
          }),
        );

        const allowed = await fork.decideApiKeyPermission({
          apiKeyId: "key-1",
          ownerUserId: "dave",
          organizationId: ORG,
          projectId: PROJECT,
          permission: "datasets:manage",
          caller: "apiKeyPath.ceiling",
          legacy: async () => true,
        });

        expect(allowed).toBe(false);
        await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ knownDivergence: "external-cap" }),
          "authz fork mismatch",
        );
      });
    });

    describe("when the key has no owner at all", () => {
      it("carries no ceiling and collects no owner snapshot", async () => {
        const reader = makeForkReader({
          findApiKeyBindings: vi
            .fn()
            .mockResolvedValue(projectBinding("ADMIN")),
        });
        const fork = makeFork(reader);

        const allowed = await fork.decideApiKeyPermission({
          apiKeyId: "key-1",
          ownerUserId: null,
          organizationId: ORG,
          projectId: PROJECT,
          permission: "datasets:manage",
          caller: "apiKeyPath.ceiling",
          legacy: async () => true,
        });

        expect(allowed).toBe(true);
        expect(reader.findUserBindings).not.toHaveBeenCalled();
        expect(reader.findOrganizationRole).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * The fail-closed posture, on every method that can be handed an id the
   * engine cannot place. It is one branch per method and each one is a
   * separate decision to deny, so each one is asserted: a method that
   * returned its collected snapshot's answer for an unresolved scope would
   * decide at the wrong scope, and nothing downstream would notice.
   */
  describe("given an id no scope can be resolved from", () => {
    describe("when several candidate permissions are asked", () => {
      it("denies, and files the unresolved outcome against legacy", async () => {
        const fork = makeFork(
          makeForkReader({
            findProjectLineage: vi.fn().mockResolvedValue(null),
          }),
        );

        const decision = await fork.decideUserPermissionsAny({
          userId: "alice",
          permissions: ["traces:view", "datasets:manage"],
          projectId: "proj-ghost",
          caller: "trpc.projectAny",
          legacy: async () => ({ allowed: true }),
        });

        expect(decision).toEqual({ allowed: false, organizationRole: null });
        await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            scopeType: "unresolved",
            permission: "traces:view | datasets:manage",
            engineAllowed: false,
            legacyAllowed: true,
          }),
          "authz fork mismatch",
        );
      });
    });

    describe("when a named principal is asked", () => {
      it("denies, and files the unresolved outcome against legacy", async () => {
        const reader = makeForkReader({
          findProjectLineage: vi.fn().mockResolvedValue(null),
        });
        const fork = makeFork(reader);

        const allowed = await fork.decidePrincipalPermission({
          principal: { type: "apiKey", id: "key-1" },
          organizationId: ORG,
          projectId: "proj-ghost",
          permission: "datasets:manage",
          caller: "apiKeyPath.keyBindings",
          legacy: async () => true,
        });

        expect(allowed).toBe(false);
        // No collection at all: there is no scope to collect for.
        expect(reader.findApiKeyBindings).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            scopeType: "unresolved",
            principalType: "apiKey",
            engineAllowed: false,
            legacyAllowed: true,
          }),
          "authz fork mismatch",
        );
      });
    });

    describe("when an api key with an owner ceiling is asked", () => {
      it("denies, and files the unresolved outcome against legacy", async () => {
        const reader = makeForkReader({
          findProjectLineage: vi.fn().mockResolvedValue(null),
        });
        const fork = makeFork(reader);

        const allowed = await fork.decideApiKeyPermission({
          apiKeyId: "key-1",
          ownerUserId: "dave",
          organizationId: ORG,
          projectId: "proj-ghost",
          permission: "datasets:manage",
          caller: "apiKeyPath.ceiling",
          legacy: async () => true,
        });

        expect(allowed).toBe(false);
        expect(reader.findApiKeyBindings).not.toHaveBeenCalled();
        expect(reader.findUserBindings).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            scopeType: "unresolved",
            engineAllowed: false,
            legacyAllowed: true,
          }),
          "authz fork mismatch",
        );
      });
    });
  });

  describe("given the comparison rate is turned down to zero", () => {
    it("answers from the engine, runs no legacy thunk, and says it stopped", async () => {
      const legacy = vi.fn(async () => false);
      let rate = 1;
      const fork = makeFork(memberWithProjectAdmin(), {
        comparisonRate: () => rate,
      });
      const check = () =>
        fork.decideUserPermission({
          userId: "alice",
          permission: "traces:view",
          projectId: PROJECT,
          caller: "trpc.project",
          legacy,
        });

      await check();
      rate = 0;
      const decision = await check();
      await new Promise((resolve) => setImmediate(resolve));

      expect(decision.allowed).toBe(true);
      // The first check compared; the second did not.
      expect(legacy).toHaveBeenCalledTimes(1);
      // Silence at warn has to be readable as agreement, so the fact that
      // comparing STOPPED is announced rather than inferred from it.
      expect(info).toHaveBeenCalledWith(
        { comparisonRate: 0 },
        "authz fork comparison disabled",
      );
    });
  });

  describe("given more comparisons than the in-flight bound allows", () => {
    it("sheds the ones over the bound and still answers every check", async () => {
      // A legacy resolver that never settles: exactly the shape the bound
      // exists for, since nothing upstream waits for these.
      const legacy = vi.fn(() => new Promise<boolean>(() => undefined));
      const fork = makeFork(memberWithProjectAdmin(), {
        maxInFlightComparisons: 2,
      });

      const decisions = await Promise.all(
        [1, 2, 3, 4].map(() =>
          fork.decideUserPermission({
            userId: "alice",
            permission: "traces:view",
            projectId: PROJECT,
            caller: "trpc.project",
            legacy,
          }),
        ),
      );

      expect(decisions.every((decision) => decision.allowed)).toBe(true);
      expect(legacy).toHaveBeenCalledTimes(2);
      expect(debug).toHaveBeenCalledWith(
        expect.objectContaining({ ceiling: 2 }),
        "authz fork comparison shed",
      );
    });
  });
});
