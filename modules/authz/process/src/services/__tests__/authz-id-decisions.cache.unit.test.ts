import { type BindingRoleKey, type CollectedBinding } from "@langwatch/authz-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StubAuthzEpoch } from "../../repositories/__tests__/support/authz-epoch.stub.ts";
import { StubAuthzLineageEpoch } from "../../repositories/__tests__/support/authz-lineage-epoch.stub.ts";
import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub.ts";
import { StubAuthzManagedGrantRepository } from "../../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub.ts";
import { LINEAGE_CACHE_MAX_AGE_MS } from "../authz-scope-lineage.service.ts";
import { AuthzService } from "../authz.service.ts";

const ORG = "org-1";
const TEAM = "team-1";
const PROJECT = "proj-1";

const alice = { type: "user", id: "alice" } as const;
const aliceKey = { type: "apiKey", id: "key-1" } as const;

function projectBinding(roleKey: BindingRoleKey): CollectedBinding {
  return { roleKey, scopeType: "PROJECT", scopeId: PROJECT, viaGroupId: null };
}

/** Bindings and the epoch are read through getters, so a test can revoke or demote mid-run. */
function makeWorld({
  cacheEnabled = true,
  lineage = { teamId: TEAM, organizationId: ORG },
}: {
  cacheEnabled?: boolean;
  lineage?: { teamId: string; organizationId: string } | null;
} = {}) {
  let aliceBindings: CollectedBinding[] = [projectBinding("admin")];
  let keyBindings: CollectedBinding[] = [projectBinding("admin")];
  let epoch = 4;
  let lineageEpoch: number | null = 0;
  let currentLineage = lineage;
  const reader = makeReader({
    findOrganizationMembership: vi.fn().mockResolvedValue({ role: "MEMBER", disabled: false }),
    findUserBindings: vi.fn(() => Promise.resolve(aliceBindings)),
    findApiKeyBindings: vi.fn(() => Promise.resolve(keyBindings)),
    findApiKeyOwner: vi.fn().mockResolvedValue({ userId: alice.id }),
    findProjectLineage: vi.fn(() => Promise.resolve(currentLineage)),
    findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
  });
  const epochPort = new StubAuthzEpoch();
  epochPort.findEpoch.mockImplementation(async () => epoch);
  const lineageEpochs = new StubAuthzLineageEpoch();
  lineageEpochs.findEpoch.mockImplementation(async () => lineageEpoch);
  lineageEpochs.bump.mockImplementation(async () => {
    lineageEpoch = (lineageEpoch ?? 0) + 1;
  });
  const authz = AuthzService.create({
    isOnEngine: async () => true,
    repository: reader,
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzManagedGrantRepository(),
    epoch: epochPort,
    lineageEpochs,
    cacheEnabled: () => cacheEnabled,
  });

  return {
    authz,
    reader,
    collects: () => reader.findUserBindings.mock.calls.length,
    lineageReads: () => reader.findProjectLineage.mock.calls.length,
    lineageEpochs,
    /** What project's fact does to storage: the project sits elsewhere, or nowhere. */
    relocate: (next: { teamId: string; organizationId: string } | null) => {
      currentLineage = next;
    },
    /** Another process heard the fact and moved the signal. */
    moveSignalElsewhere: () => {
      lineageEpoch = (lineageEpoch ?? 0) + 1;
    },
    breakSignal: () => {
      lineageEpoch = null;
    },
    /** What a grant write does: storage changes, then the organization's epoch moves. */
    write: ({
      alice: nextAlice,
      key,
    }: {
      alice?: CollectedBinding[];
      key?: CollectedBinding[];
    }) => {
      if (nextAlice) aliceBindings = nextAlice;
      if (key) keyBindings = key;
      epoch += 1;
    },
  };
}

async function askEveryIdPath(authz: AuthzService, permission: "project:delete") {
  const byId = await authz.checkByIds({ principal: alice, permission, projectId: PROJECT });
  const anyOf = await authz.canAnyByIds({
    principal: alice,
    permissions: [permission],
    projectId: PROJECT,
  });
  const batch = await authz.canBatchByIds({
    principal: alice,
    permission,
    organizationId: ORG,
    teams: [],
    projects: [{ projectId: PROJECT }],
  });

  return [byId.allowed, anyOf.allowed, batch.projects.get(PROJECT)];
}

describe("AuthzService id-asked decisions under the epoch cache", () => {
  describe("given a stable epoch", () => {
    /** @scenario "A check asked with ids answers from the held grants" */
    it("serves checkByIds, canAnyByIds and canBatchByIds from one collect", async () => {
      const { authz, collects } = makeWorld();

      expect(await askEveryIdPath(authz, "project:delete")).toEqual([true, true, true]);
      expect(await askEveryIdPath(authz, "project:delete")).toEqual([true, true, true]);

      expect(collects()).toBe(1);
    });
  });

  describe("when a revocation moves the epoch", () => {
    /** @scenario "A revocation reaches a check asked with ids on the next request" */
    it("denies every id-asked path on the next request", async () => {
      const { authz, collects, write } = makeWorld();
      expect(await askEveryIdPath(authz, "project:delete")).toEqual([true, true, true]);

      write({ alice: [] });

      expect(await askEveryIdPath(authz, "project:delete")).toEqual([false, false, false]);
      expect(collects()).toBe(2);
    });
  });

  describe("when a role change moves the epoch", () => {
    /** @scenario "A role change reaches a check asked with ids on the next request" */
    it("answers the next check by id as the new role", async () => {
      const { authz, write } = makeWorld();
      const ask = (permission: "project:delete" | "project:view") =>
        authz.checkByIds({ principal: alice, permission, projectId: PROJECT });
      expect((await ask("project:delete")).allowed).toBe(true);

      write({ alice: [projectBinding("viewer")] });

      expect((await ask("project:delete")).allowed).toBe(false);
      expect((await ask("project:view")).allowed).toBe(true);
    });
  });

  describe("when the key owner's demotion moves the epoch", () => {
    /** @scenario "Demoting a key's owner reaches a check asked with ids on the next request" */
    it("caps the key's next id-asked checks at the owner's new role", async () => {
      const { authz, write } = makeWorld();
      const askAsKey = async () => [
        (
          await authz.checkByIds({
            principal: aliceKey,
            permission: "project:delete",
            projectId: PROJECT,
          })
        ).allowed,
        (
          await authz.canAnyByIds({
            principal: aliceKey,
            permissions: ["project:delete"],
            projectId: PROJECT,
          })
        ).allowed,
        (
          await authz.canBatchByIds({
            principal: aliceKey,
            permission: "project:delete",
            organizationId: ORG,
            teams: [],
            projects: [{ projectId: PROJECT }],
          })
        ).projects.get(PROJECT),
      ];
      expect(await askAsKey()).toEqual([true, true, true]);

      write({ alice: [projectBinding("viewer")] });

      expect(await askAsKey()).toEqual([false, false, false]);
    });
  });

  describe("when an entry outlives the snapshot's age bound", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("recollects a check by id even though the epoch never moved", async () => {
      const { authz, collects } = makeWorld();

      await authz.checkByIds({ principal: alice, permission: "project:view", projectId: PROJECT });
      vi.advanceTimersByTime(30_001);
      await authz.checkByIds({ principal: alice, permission: "project:view", projectId: PROJECT });

      expect(collects()).toBe(2);
    });
  });
});

/**
 * A routed reader mid-cutover: the first pass reads the head being cut over to (alice demoted),
 * every later pass the stale head (alice still admin). The key is admin on both.
 */
function makeCutoverWorld() {
  const headReader = (aliceRole: BindingRoleKey) =>
    makeReader({
      findOrganizationMembership: vi.fn().mockResolvedValue({ role: "MEMBER", disabled: false }),
      findUserBindings: vi.fn().mockResolvedValue([projectBinding(aliceRole)]),
      findApiKeyBindings: vi.fn().mockResolvedValue([projectBinding("admin")]),
      findApiKeyOwner: vi.fn().mockResolvedValue({ userId: alice.id }),
    });
  const current = headReader("viewer");
  const stale = headReader("admin");
  let passes = 0;
  const reader = makeReader({
    findApiKeyOwner: vi.fn().mockResolvedValue({ userId: alice.id }),
    findProjectLineage: vi.fn().mockResolvedValue({ teamId: TEAM, organizationId: ORG }),
    findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
    beginPass: vi.fn(() => (passes++ === 0 ? current : stale)),
  });
  const authz = AuthzService.create({
    isOnEngine: async () => true,
    repository: reader,
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzManagedGrantRepository(),
    epoch: new StubAuthzEpoch(),
    lineageEpochs: new StubAuthzLineageEpoch(),
    cacheEnabled: () => false,
  });

  return { authz };
}

describe("AuthzService api-key ceiling with the grants cache off", () => {
  describe("when the key and its owner are read during a storage cutover", () => {
    /** @scenario "A key and its owner are read from one storage head when nothing is held" */
    it("caps checkByIds at the owner's role on the key's own head", async () => {
      const { authz } = makeCutoverWorld();

      const answer = await authz.checkByIds({
        principal: aliceKey,
        permission: "project:delete",
        projectId: PROJECT,
      });

      expect(answer.allowed).toBe(false);
    });

    /** @scenario "A key and its owner are read from one storage head when nothing is held" */
    it("caps canAnyByIds at the owner's role on the key's own head", async () => {
      const { authz } = makeCutoverWorld();

      const answer = await authz.canAnyByIds({
        principal: aliceKey,
        permissions: ["project:delete"],
        projectId: PROJECT,
      });

      expect(answer.allowed).toBe(false);
    });

    /** @scenario "A key and its owner are read from one storage head when nothing is held" */
    it("caps canBatchByIds at the owner's role on the key's own head", async () => {
      const { authz } = makeCutoverWorld();

      const answer = await authz.canBatchByIds({
        principal: aliceKey,
        permission: "project:delete",
        organizationId: ORG,
        teams: [],
        projects: [{ projectId: PROJECT }],
      });

      expect(answer.projects.get(PROJECT)).toBe(false);
    });

    /** @scenario "A key and its owner are read from one storage head when nothing is held" */
    it("caps check at the owner's role on the key's own head", async () => {
      const { authz } = makeCutoverWorld();

      const decision = await authz.check({
        principal: aliceKey,
        permission: "project:delete",
        scope: { type: "project", id: PROJECT, teamId: TEAM, organizationId: ORG },
      });

      expect(decision.allowed).toBe(false);
    });
  });
});

describe("AuthzService scope lineage cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a project already resolved once", () => {
    /** @scenario "A scope's lineage is read at most once a minute" */
    it("serves the door's getScope, checkScopeLineage and a check from one read", async () => {
      const { authz, lineageReads } = makeWorld();

      await authz.getScope({ projectId: PROJECT });
      expect(await authz.checkScopeLineage({ organizationId: ORG, projectId: PROJECT })).toEqual({
        kind: "consistent",
      });
      await authz.checkByIds({ principal: alice, permission: "project:view", projectId: PROJECT });
      await authz.canAnyByIds({
        principal: alice,
        permissions: ["project:view"],
        projectId: PROJECT,
      });

      expect(lineageReads()).toBe(1);
    });

    /** @scenario "A scope's lineage is read at most once a minute" */
    it("reads the lineage afresh after a minute", async () => {
      const { authz, lineageReads } = makeWorld();

      await authz.getScope({ projectId: PROJECT });
      vi.advanceTimersByTime(LINEAGE_CACHE_MAX_AGE_MS - 1);
      await authz.getScope({ projectId: PROJECT });
      expect(lineageReads()).toBe(1);

      vi.advanceTimersByTime(1);
      await authz.getScope({ projectId: PROJECT });
      expect(lineageReads()).toBe(2);
    });

    it("holds a team's organization the same way", async () => {
      const { authz, reader } = makeWorld();

      await authz.getScope({ teamId: TEAM });
      await authz.checkScopeLineage({ organizationId: ORG, teamId: TEAM });

      expect(reader.findTeamOrganization.mock.calls.length).toBe(1);
    });
  });

  describe("given a project that cannot be found", () => {
    /** @scenario "An unknown or archived scope is never held" */
    it("reads the lineage afresh every time", async () => {
      const { authz, lineageReads } = makeWorld({ lineage: null });

      await expect(authz.getScope({ projectId: PROJECT })).rejects.toMatchObject({
        code: "authz_scope_not_found",
      });
      await expect(authz.getScope({ projectId: PROJECT })).rejects.toMatchObject({
        code: "authz_scope_not_found",
      });

      expect(lineageReads()).toBe(2);
    });
  });

  describe("given project records that a held project moved", () => {
    /** @scenario "A moved project's lineage is read afresh on the next request" */
    it("reads the lineage afresh within the minute once the signal moves", async () => {
      const { authz, lineageReads, relocate, moveSignalElsewhere } = makeWorld();

      await authz.getScope({ projectId: PROJECT });
      relocate({ teamId: "team-2", organizationId: ORG });
      moveSignalElsewhere();
      await authz.getScope({ projectId: PROJECT });

      expect(lineageReads()).toBe(2);
    });

    /** @scenario "A moved project's lineage is read afresh on the next request" */
    it("forgets this process's held lineage when it hears the fact itself", async () => {
      const { authz, lineageReads, lineageEpochs } = makeWorld();

      await authz.getScope({ projectId: PROJECT });
      await authz.lineageChanged({ organizationId: ORG });
      await authz.getScope({ projectId: PROJECT });

      expect(lineageEpochs.bump).toHaveBeenCalledWith({ organizationId: ORG });
      expect(lineageReads()).toBe(2);
    });
  });

  describe("given project records that a held project was archived", () => {
    /** @scenario "An archived project stops resolving on the next request" */
    it("finds no scope on the next ask", async () => {
      const { authz, relocate, moveSignalElsewhere } = makeWorld();

      await authz.getScope({ projectId: PROJECT });
      relocate(null);
      moveSignalElsewhere();

      await expect(authz.getScope({ projectId: PROJECT })).rejects.toMatchObject({
        code: "authz_scope_not_found",
      });
    });
  });

  describe("given the lineage signal cannot be read", () => {
    /** @scenario "A lineage signal that cannot be read holds no lineage" */
    it("reads the lineage every time", async () => {
      const { authz, lineageReads, breakSignal } = makeWorld();
      breakSignal();

      await authz.getScope({ projectId: PROJECT });
      await authz.getScope({ projectId: PROJECT });

      expect(lineageReads()).toBe(2);
    });
  });

  describe("given the lineage signal cannot be moved", () => {
    /** @scenario "A lineage signal that cannot be moved is retried" */
    it("throws, so the subscriber's delivery is retried", async () => {
      const { authz, lineageEpochs } = makeWorld();
      lineageEpochs.bump.mockRejectedValueOnce(new Error("unavailable"));

      await expect(authz.lineageChanged({ organizationId: ORG })).rejects.toThrow("unavailable");
    });
  });

  describe("given the grants cache is off", () => {
    /** @scenario "Turning the grants cache off stops holding lineage too" */
    it("reads the lineage every time", async () => {
      const { authz, lineageReads } = makeWorld({ cacheEnabled: false });

      await authz.getScope({ projectId: PROJECT });
      await authz.getScope({ projectId: PROJECT });

      expect(lineageReads()).toBe(2);
    });
  });
});
