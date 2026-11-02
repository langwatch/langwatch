/**
 * @vitest-environment node
 * The key directory notes which credential a request resolved, for the credential census.
 * @see modules/auth/specs/request-credential-census.feature
 */
import { CLI_LOGIN_KEY_NAME_PREFIX } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { runWithCredentialSlot } from "@langwatch/observability/credential-census";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyTokenResolutionService } from "../api-key-token-resolution.service.ts";
import { ApiKeyTokenService } from "../api-key-token.service.ts";

const LEGACY_TOKEN = "sk-lw-legacy-project-key";
const PROJECT = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

async function directoryWith({ name }: { name: string }) {
  const tokens = ApiKeyTokenService.create("test-pepper");
  const minted = tokens.generate();
  const repository = MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() });
  const key = await repository.create({
    name,
    description: null,
    lookupId: minted.lookupId,
    hashedSecret: minted.hashedSecret,
    permissionMode: "all",
    userId: "user-1",
    createdByUserId: "user-1",
    organizationId: PROJECT.organizationId,
    expiresAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    startsDisabled: false,
    grants: [],
  });
  const authz = createApiFixture<AuthzApi>({
    listApiKeyBindings: async () => [
      {
        id: "binding-1",
        organizationId: PROJECT.organizationId,
        userId: null,
        groupId: null,
        apiKeyId: key.id,
        role: "MEMBER",
        customRoleId: null,
        scopeType: "PROJECT",
        scopeId: PROJECT.id,
        createdAt: new Date(0),
        user: null,
        group: null,
        apiKey: null,
        customRole: null,
      },
    ],
  });
  const projects = createApiFixture<ProjectApi>({
    findIdentity: async () => PROJECT,
    findIdByLegacyApiKey: async ({ token }) => (token === LEGACY_TOKEN ? PROJECT.id : null),
  });
  const service = ApiKeyTokenResolutionService.create({
    authz,
    grants: authz,
    organizations: createApiFixture({}),
    projects,
    bindingIds: createApiFixture({}),
    legacyGrants: { mint: () => undefined },
    tokens,
    repository,
    answers: MemoryApiKeyAnswerCacheRepository.create(),
  } as Parameters<typeof ApiKeyTokenResolutionService.create>[0]);

  return { service, token: minted.token, keyId: key.id };
}

describe("the credential the key directory notes for a request", () => {
  describe("given a project's legacy key", () => {
    it("notes a legacy project key for its project", async () => {
      const { service } = await directoryWith({ name: "a key" });

      const noted = await runWithCredentialSlot(async (slot) => {
        await service.findResolvedToken({ token: LEGACY_TOKEN });
        return slot.credential;
      });

      expect(noted).toEqual({
        credentialType: "legacy_project_key",
        projectId: PROJECT.id,
        organizationId: PROJECT.organizationId,
      });
    });
  });

  describe("given an API key bound to a project", () => {
    it("notes an API key with its row id, never the token", async () => {
      const { service, token, keyId } = await directoryWith({ name: "a key" });

      const noted = await runWithCredentialSlot(async (slot) => {
        await service.findResolvedToken({ token, projectId: PROJECT.id });
        return slot.credential;
      });

      expect(noted).toEqual({
        credentialType: "api_key",
        apiKeyId: keyId,
        projectId: PROJECT.id,
        organizationId: PROJECT.organizationId,
      });
      expect(JSON.stringify(noted)).not.toContain(token);
    });
  });

  describe("given a key a CLI login minted", () => {
    /** @scenario "A key minted by a CLI login is counted as a CLI token" */
    it("notes a CLI token with the key's row id, at the project and at the organization", async () => {
      const { service, token, keyId } = await directoryWith({
        name: `${CLI_LOGIN_KEY_NAME_PREFIX}laptop`,
      });

      const atProject = await runWithCredentialSlot(async (slot) => {
        await service.findResolvedToken({ token, projectId: PROJECT.id });
        return slot.credential;
      });
      const atOrganization = await runWithCredentialSlot(async (slot) => {
        await service.resolveOrganizationToken({ token });
        return slot.credential;
      });

      expect(atProject).toMatchObject({ credentialType: "cli_token", apiKeyId: keyId });
      expect(atOrganization).toEqual({
        credentialType: "cli_token",
        apiKeyId: keyId,
        organizationId: PROJECT.organizationId,
      });
    });
  });

  describe("given a token that matches no key", () => {
    /** @scenario "A token that resolves no credential is not counted" */
    it("notes nothing", async () => {
      const { service } = await directoryWith({ name: "a key" });

      const noted = await runWithCredentialSlot(async (slot) => {
        await service.findResolvedToken({ token: "sk-lw-nobody" });
        return slot.credential;
      });

      expect(noted).toBeUndefined();
    });
  });
});
