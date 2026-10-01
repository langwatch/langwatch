/**
 * @vitest-environment node
 * What an API-key call costs storage, and that nothing remembered outlives a revocation's
 * bound, over the module's own memory twin and real token hashing.
 * @see specs/identity/auth-read-caching.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzAccessBinding, AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi, ProjectIdentity } from "@langwatch/project-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyTokenResolutionService } from "../api-key-token-resolution.service.ts";
import { ApiKeyTokenService } from "../api-key-token.service.ts";

const START = Temporal.Instant.from("2026-09-30T09:00:00.000Z");

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
  });
  const projects = createApiFixture<ProjectApi>({
    findIdentity: async (projectId: string) => identity(projectId.replace("project-", "")),
    findIdByLegacyApiKey: async () => null,
  });
  const reads = {
    row: vi.spyOn(repository, "findByLookupId"),
    grants: vi.spyOn(authz, "listApiKeyBindings"),
    project: vi.spyOn(projects, "findIdentity"),
    legacy: vi.spyOn(projects, "findIdByLegacyApiKey"),
  };
  const service = ApiKeyTokenResolutionService.create({
    authz,
    grants: authz,
    organizations: createApiFixture(),
    projects,
    bindingIds: createApiFixture(),
    legacyGrants: { mint: () => void 0 },
    tokens,
    repository,
    now,
  });
  const mint = async ({
    organizationId,
    expiresAt = null,
  }: {
    organizationId: string;
    expiresAt?: Instant | null;
  }) => {
    const minted = tokens.generate();
    const row = await repository.create({
      name: "a key",
      description: null,
      lookupId: minted.lookupId,
      hashedSecret: minted.hashedSecret,
      permissionMode: "all",
      userId: null,
      createdByUserId: null,
      organizationId,
      expiresAt,
      ingestSourceType: null,
      ingestionTemplateId: null,
      startsDisabled: false,
      grants: [],
    });
    keyOrganizations.set(row.id, organizationId);
    return { token: minted.token, id: row.id, lookupId: minted.lookupId };
  };
  const secondsPass = (seconds: number) => {
    clock = clock.add({ milliseconds: seconds * 1000 });
  };

  return { service, repository, reads, mint, secondsPass };
}

describe("resolving an API key", () => {
  describe("when one key makes ten calls within five seconds", () => {
    /** @scenario "Repeated calls with one key read storage once" */
    it("reads its row, grants and project once", async () => {
      const { service, reads, mint, secondsPass } = harness();
      const { token } = await mint({ organizationId: "acme" });

      for (let call = 0; call < 10; call++) {
        await expect(
          service.findResolvedToken({ token, projectId: "project-acme" }),
        ).resolves.toMatchObject({ type: "apiKey", organizationId: "acme" });
        secondsPass(0.4);
      }

      expect(reads.row).toHaveBeenCalledTimes(1);
      expect(reads.grants).toHaveBeenCalledTimes(1);
      expect(reads.project).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a remembered key is revoked by another process", () => {
    /** @scenario "A revoked key is refused within five seconds" */
    it("refuses it once five seconds have passed", async () => {
      const { service, repository, mint, secondsPass } = harness();
      const { token, id } = await mint({ organizationId: "acme" });
      await expect(service.findVerifiedToken({ token })).resolves.toMatchObject({ id });

      await repository.revoke({ id, cause: "user" });
      secondsPass(5);

      await expect(service.findVerifiedToken({ token })).resolves.toBeNull();
    });

    it("refuses it at once on the process that changed it", async () => {
      const { service, repository, mint } = harness();
      const { token, id } = await mint({ organizationId: "acme" });
      await service.findVerifiedToken({ token });

      await repository.revoke({ id, cause: "user" });
      service.forget();

      await expect(service.findVerifiedToken({ token })).resolves.toBeNull();
    });
  });

  describe("when the same key id arrives with another secret", () => {
    /** @scenario "A wrong secret is refused while the right one is remembered" */
    it("refuses the wrong secret", async () => {
      const { service, mint } = harness();
      const { token, lookupId } = await mint({ organizationId: "acme" });
      await expect(service.findVerifiedToken({ token })).resolves.not.toBeNull();

      const forged = `sk-lw-${lookupId}_${"x".repeat(48)}`;

      await expect(service.findVerifiedToken({ token: forged })).resolves.toBeNull();
      await expect(service.findResolvedToken({ token: forged })).resolves.toBeNull();
    });
  });

  describe("when a token matches no key", () => {
    /** @scenario "An unknown key is remembered as unknown for a moment only" */
    it("asks storage once for concurrent calls and again after two seconds", async () => {
      const { service, reads, secondsPass } = harness();
      const unknown = `sk-lw-${"q".repeat(16)}_${"r".repeat(48)}`;

      await Promise.all([
        service.findVerifiedToken({ token: unknown }),
        service.findVerifiedToken({ token: unknown }),
      ]);
      expect(reads.row).toHaveBeenCalledTimes(1);

      secondsPass(2);
      await expect(service.findVerifiedToken({ token: unknown })).resolves.toBeNull();
      expect(reads.row).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a remembered key reaches its expiry", () => {
    /** @scenario "A key past its expiry is refused even while remembered" */
    it("refuses it once expired", async () => {
      const { service, mint, secondsPass } = harness();
      const { token } = await mint({
        organizationId: "acme",
        expiresAt: START.add({ seconds: 2 }),
      });
      await expect(service.findVerifiedToken({ token })).resolves.not.toBeNull();

      secondsPass(3);

      await expect(service.findVerifiedToken({ token })).resolves.toBeNull();
    });
  });

  describe("when two organizations' keys are both remembered", () => {
    /** @scenario "Two keys never share a remembered answer" */
    it("resolves each to its own organization", async () => {
      const { service, mint } = harness();
      const acme = await mint({ organizationId: "acme" });
      const globex = await mint({ organizationId: "globex" });

      for (let round = 0; round < 2; round++) {
        await expect(service.findResolvedToken({ token: acme.token })).resolves.toMatchObject({
          organizationId: "acme",
          project: { organizationId: "acme" },
        });
        await expect(service.findResolvedToken({ token: globex.token })).resolves.toMatchObject({
          organizationId: "globex",
          project: { organizationId: "globex" },
        });
      }
    });
  });
});
