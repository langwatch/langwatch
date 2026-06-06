/**
 * @vitest-environment node
 *
 * Regression coverage for ingest-key issuance + self-scoping resolution —
 * the two runtime gaps the once-and-final dogfood surfaced on the unified
 * ApiKey foundation (both invisible to typecheck + the management-only
 * integration tests, because they only bite at query time / on the OTLP
 * receiver path):
 *
 *   1. ensureForProject -> ApiKeyRepository.findIngestKey queried ApiKey
 *      WITHOUT organizationId, so the org-tenancy guard
 *      (dbOrganizationIdProtection) rejected every mint/rotate at runtime.
 *      The mints below exercise that path; a missing organizationId predicate
 *      throws before a token is ever returned.
 *
 *   2. TokenResolver.resolveApiKey required an externally-supplied projectId.
 *      An ingestion key is self-scoping: the OTLP exporter inside a wrapped
 *      `langwatch <tool>` child authenticates with the bearer token alone (no
 *      projectId header / basic-auth), so the resolver must derive the bound
 *      project from the key's PROJECT-scoped role binding. Without it the
 *      receiver 401'd ("Invalid auth token") every real ingest. This now
 *      generalises: ANY key scoped to exactly one project self-scopes;
 *      two-or-more-project keys stay ambiguous and require an explicit
 *      projectId.
 *
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { TokenResolver } from "~/server/api-key/token-resolver";

import { IngestionKeyService } from "../ingestionKey.service";
import { ensureHiddenGovernanceProject } from "../governanceProject.service";

const suffix = nanoid(8);
const ORG_ID = `org-ik-${suffix}`;
const USER_ID = `usr-ik-${suffix}`;
const TEAM_ID = `team-ik-${suffix}`;
const PROJECT_ID = `proj-ik-${suffix}`;
const OTHER_TEAM_ID = `team-ik2-${suffix}`;
const OTHER_PROJECT_ID = `proj-ik2-${suffix}`;

describe("IngestionKey issuance + self-scoping resolution", () => {
  const ingestKeys = IngestionKeyService.create(prisma);
  const resolver = TokenResolver.create(prisma);

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `IK ${suffix}`, slug: `ik-${suffix}` },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `ik-${suffix}@example.com`, name: "IK User" },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: USER_ID, role: "ADMIN" },
    });
    // Org-scoped ADMIN RoleBinding so the user-owned-key ceiling check
    // (assertBindingsWithinCeiling) lets the caller grant traces:create.
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      },
    });
    await prisma.team.create({
      data: { id: TEAM_ID, organizationId: ORG_ID, name: `team ${suffix}`, slug: `team-${suffix}` },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        teamId: TEAM_ID,
        name: `proj ${suffix}`,
        slug: `proj-${suffix}`,
        apiKey: `proj-key-${suffix}`,
        language: "other",
        framework: "other",
      },
    });
    await prisma.team.create({
      data: { id: OTHER_TEAM_ID, organizationId: ORG_ID, name: `team2 ${suffix}`, slug: `team2-${suffix}` },
    });
    await prisma.project.create({
      data: {
        id: OTHER_PROJECT_ID,
        teamId: OTHER_TEAM_ID,
        name: `proj2 ${suffix}`,
        slug: `proj2-${suffix}`,
        apiKey: `proj2-key-${suffix}`,
        language: "other",
        framework: "other",
      },
    });
  });

  afterAll(async () => {
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    await prisma.apiKey.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    await prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    await prisma.project
      .deleteMany({ where: { teamId: { in: [TEAM_ID, OTHER_TEAM_ID] } } })
      .catch(() => undefined);
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: USER_ID } }).catch(() => undefined);
    await prisma.organization.deleteMany({ where: { id: ORG_ID } }).catch(() => undefined);
  });

  describe("when an ingest key is issued for a project", () => {
    it("mints through the org-tenancy guard and self-scopes on resolution with no projectId", async () => {
      const issued = await ingestKeys.ensureForProject({
        callerUserId: USER_ID,
        ownerUserId: USER_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        sourceType: "claude_code",
      });
      expect(issued.token).toMatch(/^sk-lw-/);

      // The OTLP exporter inside the wrapped tool sends the bearer token
      // alone — no projectId. The key must resolve to its bound project.
      const resolved = await resolver.resolve({ token: issued.token, projectId: null });
      expect(resolved).not.toBeNull();
      expect(resolved?.type).toBe("apiKey");
      if (resolved?.type === "apiKey") {
        expect(resolved.project.id).toBe(PROJECT_ID);
        expect(resolved.ingestSourceType).toBe("claude_code");
        expect(resolved.ingestionTemplateId).toBeNull();
      }
    });
  });

  describe("when an ordinary (non-ingest) API key is scoped to one project", () => {
    it("self-scopes to that project without an explicit projectId", async () => {
      const { token } = await ApiKeyService.create(prisma).create({
        name: `ordinary-single ${suffix}`,
        userId: USER_ID,
        createdByUserId: USER_ID,
        organizationId: ORG_ID,
        permissionMode: "restricted",
        permissions: ["traces:create"],
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: PROJECT_ID }],
      });

      // A single PROJECT-scoped binding is unambiguous, so the key resolves to
      // its one project even though it is not an ingestion key.
      const resolved = await resolver.resolve({ token, projectId: null });
      expect(resolved?.type).toBe("apiKey");
      if (resolved?.type === "apiKey") {
        expect(resolved.project.id).toBe(PROJECT_ID);
        expect(resolved.ingestSourceType).toBeNull();
      }
    });
  });

  describe("when an API key is scoped to two projects", () => {
    it("stays ambiguous without a projectId, resolves with one", async () => {
      const { token } = await ApiKeyService.create(prisma).create({
        name: `multi-project ${suffix}`,
        userId: USER_ID,
        createdByUserId: USER_ID,
        organizationId: ORG_ID,
        permissionMode: "restricted",
        permissions: ["traces:create"],
        bindings: [
          { role: "CUSTOM", scopeType: "PROJECT", scopeId: PROJECT_ID },
          { role: "CUSTOM", scopeType: "PROJECT", scopeId: OTHER_PROJECT_ID },
        ],
      });

      // Two projects in scope => the caller must say which one.
      expect(await resolver.resolve({ token, projectId: null })).toBeNull();
      const resolved = await resolver.resolve({
        token,
        projectId: OTHER_PROJECT_ID,
      });
      expect(resolved?.type).toBe("apiKey");
      if (resolved?.type === "apiKey") {
        expect(resolved.project.id).toBe(OTHER_PROJECT_ID);
      }
    });
  });

  describe("when an ingest key is rotated in place", () => {
    it("revokes the previous token so it stops resolving", async () => {
      const first = await ingestKeys.ensureForProject({
        callerUserId: USER_ID,
        ownerUserId: USER_ID,
        organizationId: ORG_ID,
        projectId: OTHER_PROJECT_ID,
        sourceType: "codex",
      });
      const second = await ingestKeys.ensureForProject({
        callerUserId: USER_ID,
        ownerUserId: USER_ID,
        organizationId: ORG_ID,
        projectId: OTHER_PROJECT_ID,
        sourceType: "codex",
      });
      expect(second.token).not.toBe(first.token);

      expect(await resolver.resolve({ token: first.token, projectId: null })).toBeNull();
      const live = await resolver.resolve({ token: second.token, projectId: null });
      expect(live?.type).toBe("apiKey");
      if (live?.type === "apiKey") {
        expect(live.project.id).toBe(OTHER_PROJECT_ID);
      }
    });
  });

  describe("when an admin mints a company-wide governance-project key", () => {
    it("binds to the org Governance Project and self-scopes there", async () => {
      const govProject = await ensureHiddenGovernanceProject(prisma, ORG_ID);

      const issued = await ingestKeys.ensureForOrganizationGovernanceProject({
        callerUserId: USER_ID,
        organizationId: ORG_ID,
        sourceType: "copilot_studio",
      });
      expect(issued.token).toMatch(/^sk-lw-/);

      // The OTLP exporter inside the company-wide tool (Copilot Studio) sends
      // the bearer token alone; it must resolve to the hidden Governance
      // Project, not a personal one.
      const resolved = await resolver.resolve({ token: issued.token, projectId: null });
      expect(resolved?.type).toBe("apiKey");
      if (resolved?.type === "apiKey") {
        expect(resolved.project.id).toBe(govProject.id);
        expect(resolved.ingestSourceType).toBe("copilot_studio");
      }
    });
  });
});
