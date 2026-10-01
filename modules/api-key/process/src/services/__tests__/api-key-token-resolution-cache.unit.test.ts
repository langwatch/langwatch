/**
 * @vitest-environment node
 * The API-key check, shared through one Redis twin by two pods: what it costs Postgres,
 * how long an answer is held, and that a revoke on one pod ends the key on the other at once.
 * @see modules/api-key/specs/auth-check-cache.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { WORKFLOW_RUN_API_KEY_NAME } from "@langwatch/api-key-contract";
import type { AuthzAccessBinding, AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi, ProjectIdentity } from "@langwatch/project-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import type { ApiKeyGrantId } from "../api-key-grant-id.service.ts";
import { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service.ts";
import { ApiKeyLifecycleService } from "../api-key-lifecycle.service.ts";
import { ApiKeyTokenResolutionService } from "../api-key-token-resolution.service.ts";
import { ApiKeyTokenService } from "../api-key-token.service.ts";
import type { ApiKeyDependencies } from "../api-key.service.ts";

const START = Temporal.Instant.from("2026-10-01T09:00:00.000Z");

const identity = (organizationId: string): ProjectIdentity => ({
  id: `project-${organizationId}`,
  name: "Project",
  slug: "project",
  teamId: `team-${organizationId}`,
  organizationId,
  isPersonal: false,
  ownerUserId: null,
});

function harness() {
  let clock = START;
  const now = (): Instant => clock;
  const repository = MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() });
  const answers = MemoryApiKeyAnswerCacheRepository.create({ now });
  const tokens = ApiKeyTokenService.create("test-pepper");
  const keyOrganizations = new Map<string, string>();
  const authz = createApiFixture<AuthzApi>({
    listApiKeyBindings: async ({ apiKeyIds }) =>
      apiKeyIds.map((apiKeyId): AuthzAccessBinding => ({
        id: `grant-${apiKeyId}`,
        organizationId: keyOrganizations.get(apiKeyId) ?? "",
        userId: null,
        groupId: null,
        apiKeyId,
        role: "VIEWER",
        customRoleId: null,
        scopeType: "PROJECT",
        scopeId: `project-${keyOrganizations.get(apiKeyId)}`,
        createdAt: new Date(0),
        user: null,
        group: null,
        apiKey: null,
        customRole: null,
      })),
    revokeBindingsWhere: async () => 0,
  });
  const projects = createApiFixture<ProjectApi>({
    findIdentity: async (projectId: string) => identity(projectId.replace("project-", "")),
    findIdByLegacyApiKey: async ({ token }) => (token === "legacy-acme" ? "project-acme" : null),
  });
  const dependencies: ApiKeyDependencies & { repository: ApiKeyRepository } = {
    authz,
    grants: authz,
    organizations: createApiFixture<OrganizationApi>(),
    projects,
    bindingIds: createApiFixture<ApiKeyGrantId>(),
    legacyGrants: { mint: () => void 0 },
    tokens,
    repository,
  };
  const pod = () => ApiKeyTokenResolutionService.create({ ...dependencies, answers, now });
  const podA = pod();
  const podB = pod();
  const lifecycleOnA = ApiKeyLifecycleService.create(
    dependencies,
    ApiKeyGrantPolicyService.create(dependencies),
    podA,
  );
  const reads = {
    row: vi.spyOn(repository, "findByLookupId"),
    grants: vi.spyOn(authz, "listApiKeyBindings"),
    legacy: vi.spyOn(projects, "findIdByLegacyApiKey"),
    identity: vi.spyOn(projects, "findIdentity"),
    held: vi.spyOn(answers, "findValues"),
  };
  const mint = async ({
    organizationId,
    expiresAt = null,
    name = "a key",
    parentApiKeyId = null,
    isSystemManaged = false,
  }: {
    organizationId: string;
    expiresAt?: Instant | null;
    name?: string;
    parentApiKeyId?: string | null;
    isSystemManaged?: boolean;
  }) => {
    const minted = tokens.generate();
    const row = await repository.create({
      name,
      description: null,
      lookupId: minted.lookupId,
      hashedSecret: minted.hashedSecret,
      permissionMode: "all",
      userId: null,
      createdByUserId: null,
      parentApiKeyId,
      organizationId,
      expiresAt,
      ingestSourceType: null,
      ingestionTemplateId: null,
      isSystemManaged,
      startsDisabled: false,
      grants: [],
    });
    keyOrganizations.set(row.id, organizationId);
    return { token: minted.token, id: row.id, lookupId: minted.lookupId, row };
  };
  const secondsPass = (seconds: number) => {
    clock = clock.add({ milliseconds: seconds * 1000 });
  };

  return { podA, podB, lifecycleOnA, answers, repository, reads, mint, secondsPass };
}

describe("checking an API key through the shared answers", () => {
  describe("when one key makes ten calls within five seconds across two pods", () => {
    /** @scenario "Repeated calls with one key read Postgres once" */
    it("reads its row and grants once", async () => {
      const { podA, podB, reads, mint, secondsPass } = harness();
      const { token } = await mint({ organizationId: "acme" });

      for (let call = 0; call < 10; call++) {
        const pod = call % 2 === 0 ? podA : podB;
        await expect(
          pod.findResolvedToken({ token, projectId: "project-acme" }),
        ).resolves.toMatchObject({ type: "apiKey", organizationId: "acme" });
        secondsPass(0.4);
      }

      expect(reads.row).toHaveBeenCalledTimes(1);
      expect(reads.grants).toHaveBeenCalledTimes(1);
      expect(reads.identity).toHaveBeenCalledTimes(1);
    });
  });

  describe("when one pod checks a token several times at once", () => {
    /** @scenario "Concurrent checks of one token on one pod read Postgres once" */
    it("shares one read between them", async () => {
      const { podA, reads, mint, repository } = harness();
      const { token, id, lookupId } = await mint({ organizationId: "acme" });
      const row = await repository.findByLookupId({ lookupId });
      reads.row.mockClear();
      const gate = opened();
      reads.row.mockImplementationOnce(async () => {
        await gate.wait;
        return row;
      });

      const checks = [1, 2, 3].map(() => podA.findVerifiedToken({ token }));
      await allPendingWork();
      gate.open();

      for (const check of await Promise.all(checks)) expect(check).toMatchObject({ id });
      expect(reads.row).toHaveBeenCalledTimes(1);
    });
  });

  describe("when another pod already checked the key", () => {
    /** @scenario "Redis is asked before Postgres" */
    it("answers from Redis without reading Postgres", async () => {
      const { podA, podB, reads, mint } = harness();
      const { token, id } = await mint({ organizationId: "acme" });
      await podA.findVerifiedToken({ token });
      reads.row.mockClear();
      reads.held.mockClear();

      await expect(podB.findVerifiedToken({ token })).resolves.toMatchObject({ id });

      expect(reads.held).toHaveBeenCalled();
      expect(reads.row).not.toHaveBeenCalled();
    });

    it("asks Redis first on a miss", async () => {
      const { podA, reads, mint } = harness();
      const { token } = await mint({ organizationId: "acme" });

      await podA.findVerifiedToken({ token });

      const [firstHeld] = reads.held.mock.invocationCallOrder;
      const [firstRow] = reads.row.mock.invocationCallOrder;
      expect(firstHeld).toBeLessThan(firstRow ?? 0);
    });
  });

  describe("when a key held on both pods is revoked on one", () => {
    /** @scenario "A revoked key is refused on another pod's next request" */
    it("is refused on the other pod's next request, with no time passing", async () => {
      const { podA, podB, lifecycleOnA, mint } = harness();
      const { token, id } = await mint({ organizationId: "acme" });
      await expect(podB.findVerifiedToken({ token })).resolves.toMatchObject({ id });

      await lifecycleOnA.revoke({
        id,
        organizationId: "acme",
        callerUserId: null,
        callerIsAdmin: true,
      });

      await expect(podB.findVerifiedToken({ token })).resolves.toBeNull();
      await expect(podA.findVerifiedToken({ token })).resolves.toBeNull();
    });
  });

  describe("when a check read Postgres before a revoke and fills Redis after it", () => {
    /** @scenario "A revoke's refusal beats a late fill from an earlier read" */
    it("keeps the refusal, so every pod refuses the key", async () => {
      const { podA, podB, lifecycleOnA, answers, reads, mint, repository } = harness();
      const { token, id, lookupId } = await mint({ organizationId: "acme" });
      const beforeRevoke = await repository.findByLookupId({ lookupId });
      const gate = opened();
      reads.row.mockImplementationOnce(async () => {
        await gate.wait;
        return beforeRevoke;
      });
      const late = podB.findVerifiedToken({ token });

      await lifecycleOnA.revoke({
        id,
        organizationId: "acme",
        callerUserId: null,
        callerIsAdmin: true,
      });
      gate.open();
      await late;

      await expect(answers.findValues({ key: `pat:${lookupId}` })).resolves.toEqual(["revoked"]);
      await expect(podA.findVerifiedToken({ token })).resolves.toBeNull();
      await expect(podB.findResolvedToken({ token })).resolves.toBeNull();
    });
  });

  describe("when a check's Postgres read outlasts the revoke's refusal", () => {
    /** @scenario "A fill never outlives a refusal written after its read began" */
    it("skips the fill, so another pod still refuses the key", async () => {
      const { podA, podB, lifecycleOnA, answers, reads, mint, repository, secondsPass } =
        harness();
      const { token, id, lookupId } = await mint({ organizationId: "acme" });
      const beforeRevoke = await repository.findByLookupId({ lookupId });
      const gate = opened();
      reads.row.mockImplementationOnce(async () => {
        await gate.wait;
        return beforeRevoke;
      });
      const late = podB.findVerifiedToken({ token });
      await allPendingWork();

      await lifecycleOnA.revoke({
        id,
        organizationId: "acme",
        callerUserId: null,
        callerIsAdmin: true,
      });
      secondsPass(6);
      gate.open();
      await late;

      await expect(answers.findValues({ key: `pat:${lookupId}` })).resolves.toEqual([]);
      await expect(podA.findVerifiedToken({ token })).resolves.toBeNull();
    });
  });

  describe("when a held project is reused for a caller who names it", () => {
    /** @scenario "A held project from another organization is still refused" */
    it("refuses a project of another organization on every request", async () => {
      const { podA, podB, reads, mint } = harness();
      const { token } = await mint({ organizationId: "acme" });

      for (const pod of [podA, podB]) {
        await expect(
          pod.findResolvedToken({ token, projectId: "project-globex" }),
        ).resolves.toBeNull();
      }
      expect(reads.identity).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A held project outside the key's bindings is still refused" */
    it("refuses a project of the same organization the key is not bound to", async () => {
      const { podA, podB, reads, mint } = harness();
      const { token } = await mint({ organizationId: "acme" });
      reads.identity.mockResolvedValue({
        ...identity("acme"),
        id: "project-elsewhere",
        teamId: "team-elsewhere",
      });

      for (const pod of [podA, podB]) {
        await expect(
          pod.findResolvedToken({ token, projectId: "project-elsewhere" }),
        ).resolves.toBeNull();
      }
      expect(reads.identity).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a login key whose child key is held is revoked", () => {
    /** @scenario "A revoke's cascade refuses each child key on every pod at once" */
    it("refuses the child on the other pod's next request, with no time passing", async () => {
      const { podB, lifecycleOnA, mint } = harness();
      const parent = await mint({ organizationId: "acme", name: "CLI login - laptop" });
      const child = await mint({ organizationId: "acme", parentApiKeyId: parent.id });
      await expect(podB.findVerifiedToken({ token: child.token })).resolves.toMatchObject({
        id: child.id,
      });

      await lifecycleOnA.revoke({
        id: parent.id,
        organizationId: "acme",
        callerUserId: null,
        callerIsAdmin: true,
      });

      await expect(podB.findVerifiedToken({ token: child.token })).resolves.toBeNull();
    });
  });

  describe("when a key held on both pods is changed on one", () => {
    /** @scenario "A changed key is read afresh on another pod's next request" */
    it("reads Postgres again on the other pod, with no time passing", async () => {
      const { podB, lifecycleOnA, reads, mint } = harness();
      const { token, id } = await mint({ organizationId: "acme" });
      await expect(podB.findVerifiedToken({ token })).resolves.toMatchObject({ name: "a key" });

      await lifecycleOnA.update({
        id,
        organizationId: "acme",
        callerUserId: null,
        callerIsAdmin: true,
        name: "renamed",
      });

      await expect(podB.findVerifiedToken({ token })).resolves.toMatchObject({ name: "renamed" });
      expect(reads.row).toHaveBeenCalledTimes(2);
    });
  });

  describe("when Redis is down", () => {
    /** @scenario "With Redis down, Postgres answers and a revoked key is never valid" */
    it("answers from Postgres, so a live key passes and a revoked one is refused", async () => {
      const { podA, lifecycleOnA, answers, reads, mint } = harness();
      const live = await mint({ organizationId: "acme" });
      const revoked = await mint({ organizationId: "acme" });
      const down = new Error("connect ECONNREFUSED");
      reads.held.mockRejectedValue(down);
      vi.spyOn(answers, "set").mockRejectedValue(down);
      vi.spyOn(answers, "delete").mockRejectedValue(down);

      await lifecycleOnA.revoke({
        id: revoked.id,
        organizationId: "acme",
        callerUserId: null,
        callerIsAdmin: true,
      });

      await expect(podA.findVerifiedToken({ token: live.token })).resolves.toMatchObject({
        id: live.id,
      });
      await expect(podA.findVerifiedToken({ token: revoked.token })).resolves.toBeNull();
      expect(reads.row).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a held answer is five seconds old", () => {
    /** @scenario "A held answer lapses after five seconds" */
    it("reads Postgres again", async () => {
      const { podA, reads, mint, secondsPass } = harness();
      const { token } = await mint({ organizationId: "acme" });
      await podA.findVerifiedToken({ token });

      secondsPass(4.9);
      await podA.findVerifiedToken({ token });
      expect(reads.row).toHaveBeenCalledTimes(1);

      secondsPass(0.2);
      await podA.findVerifiedToken({ token });
      expect(reads.row).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the same key id arrives with another secret", () => {
    /** @scenario "A wrong secret is refused while the right one is held" */
    it("refuses the wrong secret", async () => {
      const { podA, podB, mint } = harness();
      const { token, lookupId } = await mint({ organizationId: "acme" });
      await expect(podA.findVerifiedToken({ token })).resolves.not.toBeNull();

      const forged = `sk-lw-${lookupId}_${"x".repeat(48)}`;

      await expect(podB.findVerifiedToken({ token: forged })).resolves.toBeNull();
      await expect(podB.findResolvedToken({ token: forged })).resolves.toBeNull();
      await expect(podB.findVerifiedToken({ token })).resolves.not.toBeNull();
    });
  });

  describe("when a token matches no key", () => {
    /** @scenario "An unknown token is held as unknown for two seconds, then checked again" */
    it("asks Postgres once and again after two seconds", async () => {
      const { podA, podB, reads, secondsPass } = harness();
      const unknown = `sk-lw-${"q".repeat(16)}_${"r".repeat(48)}`;

      await expect(podA.findVerifiedToken({ token: unknown })).resolves.toBeNull();
      await expect(podB.findVerifiedToken({ token: unknown })).resolves.toBeNull();
      expect(reads.row).toHaveBeenCalledTimes(1);

      secondsPass(2);
      await expect(podB.findVerifiedToken({ token: unknown })).resolves.toBeNull();
      expect(reads.row).toHaveBeenCalledTimes(2);
    });
  });

  describe("when Postgres fails mid-check", () => {
    /** @scenario "A failed check is never held" */
    it("holds nothing, so the next request checks again and is answered truly", async () => {
      const { podA, podB, reads, mint, answers } = harness();
      const { token, id, lookupId } = await mint({ organizationId: "acme" });
      reads.row.mockRejectedValueOnce(new Error("connection reset"));

      await expect(podA.findVerifiedToken({ token })).rejects.toThrow("connection reset");
      await expect(answers.findValues({ key: `pat:${lookupId}` })).resolves.toEqual([]);

      await expect(podB.findVerifiedToken({ token })).resolves.toMatchObject({ id });
      expect(reads.row).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a held key reaches its expiry", () => {
    /** @scenario "A key past its expiry is refused even while held" */
    it("refuses it once expired", async () => {
      const { podA, podB, mint, secondsPass } = harness();
      const { token } = await mint({
        organizationId: "acme",
        expiresAt: START.add({ seconds: 2 }),
      });
      await expect(podA.findVerifiedToken({ token })).resolves.not.toBeNull();

      secondsPass(3);

      await expect(podB.findVerifiedToken({ token })).resolves.toBeNull();
    });
  });

  describe("when two organizations' keys are both held", () => {
    /** @scenario "Two keys never share a held answer" */
    it("resolves each to its own organization", async () => {
      const { podA, podB, mint } = harness();
      const acme = await mint({ organizationId: "acme" });
      const globex = await mint({ organizationId: "globex" });

      for (const pod of [podA, podB]) {
        await expect(pod.findResolvedToken({ token: acme.token })).resolves.toMatchObject({
          organizationId: "acme",
          project: { organizationId: "acme" },
        });
        await expect(pod.findResolvedToken({ token: globex.token })).resolves.toMatchObject({
          organizationId: "globex",
          project: { organizationId: "globex" },
        });
      }
    });
  });

  describe("when an answer is held", () => {
    /** @scenario "A held answer carries no secret" */
    it("holds neither the token, its secret nor the stored hash", async () => {
      const { podA, answers, mint } = harness();
      const { token, lookupId, row } = await mint({ organizationId: "acme" });
      await podA.findVerifiedToken({ token });

      const [held = ""] = await answers.findValues({ key: `pat:${lookupId}` });

      expect(held).not.toBe("");
      expect(held).not.toContain(token);
      expect(held).not.toContain(token.slice(token.lastIndexOf("_") + 1));
      expect(held).not.toContain(row.hashedSecret);
    });
  });

  describe("when an unowned run key is answered from Redis", () => {
    /** @scenario "An unattended run key is still known as one when its answer is held" */
    it("still resolves as an unattended run key", async () => {
      const { podA, podB, reads, mint } = harness();
      const { token } = await mint({
        organizationId: "acme",
        name: WORKFLOW_RUN_API_KEY_NAME,
        isSystemManaged: true,
      });
      await podA.findResolvedToken({ token });

      await expect(podB.findResolvedToken({ token })).resolves.toMatchObject({
        isUnattendedRunKey: true,
      });
      expect(reads.row).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A customer key named like a system key stays visible and manageable" */
    it("never treats a customer's ownerless key of the same name as one", async () => {
      const { podA, mint } = harness();
      const { token } = await mint({ organizationId: "acme", name: WORKFLOW_RUN_API_KEY_NAME });

      await expect(podA.findResolvedToken({ token })).resolves.toMatchObject({
        isUnattendedRunKey: false,
      });
    });
  });

  describe("when a legacy project key is checked on two pods", () => {
    /** @scenario "A legacy project key's answer is held for five seconds" */
    it("asks the project once until five seconds pass", async () => {
      const { podA, podB, reads, secondsPass } = harness();

      await expect(podA.findResolvedToken({ token: "legacy-acme" })).resolves.toMatchObject({
        type: "legacyProjectKey",
        project: { id: "project-acme" },
      });
      await podB.findResolvedToken({ token: "legacy-acme" });
      expect(reads.legacy).toHaveBeenCalledTimes(1);

      expect(reads.identity).toHaveBeenCalledTimes(1);

      secondsPass(5);
      await podB.findResolvedToken({ token: "legacy-acme" });
      expect(reads.legacy).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a revoked legacy key's column value is presented", () => {
    /** @scenario "A revoked legacy key's column value is refused before any lookup" */
    it("is refused without asking Redis or the project", async () => {
      const { podA, reads } = harness();
      reads.legacy.mockResolvedValue("project-acme");
      const token = "lw-revoked-2Zr6JhYyYQ3pN8tVb1sKqLmXwEo";

      await expect(podA.findResolvedToken({ token })).resolves.toBeNull();
      await expect(podA.resolveOrganizationToken({ token })).resolves.toEqual({
        ok: false,
        reason: "unusable_credential",
      });
      expect(reads.legacy).not.toHaveBeenCalled();
      expect(reads.held).not.toHaveBeenCalled();
    });
  });
});

/** A read held open until the test lets it through. */
function opened(): { wait: Promise<void>; open: () => void } {
  let open = (): void => void 0;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { wait, open: () => open() };
}

/** Lets every queued promise step run before the test goes on. */
function allPendingWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
