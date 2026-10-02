/**
 * @vitest-environment node
 *
 * Project API keys stored as hashes, against a real database: the lookup
 * order and the sweep's guarded writes are what is under test, so a mocked
 * client would only hand back what the test told it to.
 *
 * "Before the migration" is a project whose key is stored in plaintext only,
 * the way every key was stored before this change. "After" is the same key
 * once the sweep has hashed it, and once it has cleared the plaintext.
 *
 * Requires: PostgreSQL database (Prisma)
 *
 * @see specs/api-keys/project-key-hashed-storage.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";

import { prisma } from "~/server/db";
import { generateApiKey } from "~/server/utils/apiKeyGenerator";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

import { ApiKeyService } from "../api-key.service";

import {
  findProjectByApiKey,
  hashProjectApiKey,
  mintProjectApiKey,
  PROJECT_API_KEY_PLAINTEXT_GRACE_MS,
  sweepProjectApiKeys,
} from "../project-api-key";
import { getProjectInternalKey } from "../project-internal-key";
import { TokenResolver } from "../token-resolver";

wireDefaultTestApp();

describe("Feature: Project API keys are stored as hashes", () => {
  const ns = `project-api-key-${nanoid(8)}`;
  const resolver = TokenResolver.create(prisma);
  let organizationId: string;
  let teamId: string;

  /** A project whose key is stored the way keys were stored before hashing. */
  const createPlaintextProject = async () => {
    const token = generateApiKey();
    const project = await prisma.project.create({
      data: {
        name: "Plaintext Project",
        slug: `--test-project-${ns}-${nanoid(6).toLowerCase()}`,
        apiKey: token,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    return { token, projectId: project.id };
  };

  const storedKey = (projectId: string) =>
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        apiKey: true,
        apiKeyHash: true,
        apiKeyLast4: true,
        apiKeyHashedAt: true,
      },
    });

  /** The sweep scans every project, so tests only assert their own rows. */
  const sweep = (opts?: { now?: Date; graceMs?: number }) =>
    sweepProjectApiKeys({ prisma, ...opts });

  /** POST /api/auth/validate, the route the Python SDK's login checks a key with. */
  const validateOverHttp = async (token: string) => {
    const { app } = await import("~/server/routes/auth");
    return app.request("/api/auth/validate", {
      method: "POST",
      headers: { "X-Auth-Token": token },
    });
  };

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Hashed Key Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: {
        name: "Hashed Key Team",
        slug: `--test-team-${ns}`,
        organizationId,
      },
    });
    teamId = team.id;
  });

  afterAll(async () => {
    await prisma.apiKey
      .deleteMany({ where: { organization: { slug: `--test-org-${ns}` } } })
      .catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { organization: { slug: `--test-org-${ns}` } } })
      .catch(() => {});
    await prisma.roleBinding
      .deleteMany({ where: { organization: { slug: `--test-org-${ns}` } } })
      .catch(() => {});
    await prisma.user
      .deleteMany({ where: { email: { startsWith: `${ns}-` } } })
      .catch(() => {});
    await prisma.project
      .deleteMany({ where: { slug: { startsWith: `--test-project-${ns}` } } })
      .catch(() => {});
    await prisma.team
      .deleteMany({ where: { slug: { startsWith: `--test-team-${ns}` } } })
      .catch(() => {});
    await prisma.organization
      .deleteMany({ where: { slug: { startsWith: `--test-org-${ns}` } } })
      .catch(() => {});
  });

  describe("given a key stored in plaintext only", () => {
    describe("when a request authenticates with it before the sweep runs", () => {
      /** @scenario "A key stored in plaintext authenticates before the sweep runs" */
      it("authenticates as the project and stores the key's hash", async () => {
        const { token, projectId } = await createPlaintextProject();

        const resolved = await resolver.resolve({ token });

        expect(resolved?.type).toBe("legacyProjectKey");
        expect(resolved?.project.id).toBe(projectId);
        const stored = await storedKey(projectId);
        expect(stored.apiKeyHash).toBe(hashProjectApiKey(token));
        expect(stored.apiKeyLast4).toBe(token.slice(-4));
        expect(stored.apiKeyHashedAt).not.toBeNull();
        expect(stored.apiKey).toBe(token);
      });

      it("validates over HTTP for the SDK login", async () => {
        const { token } = await createPlaintextProject();

        const res = await validateOverHttp(token);

        expect(res.status).toBe(200);
      });
    });

    describe("when the sweep runs", () => {
      /** @scenario "A key authenticates after the sweep hashed it" */
      it("stores the hash and last four characters and keeps authenticating", async () => {
        const { token, projectId } = await createPlaintextProject();

        await sweep();

        const stored = await storedKey(projectId);
        expect(stored.apiKeyHash).toBe(hashProjectApiKey(token));
        expect(stored.apiKeyLast4).toBe(token.slice(-4));
        const resolved = await resolver.resolve({ token });
        expect(resolved?.project.id).toBe(projectId);
      });
    });

    describe("when the sweep runs inside the grace window", () => {
      /** @scenario "The plaintext stays during the grace window" */
      it("keeps the plaintext", async () => {
        const { token, projectId } = await createPlaintextProject();
        await sweep();

        await sweep({
          now: new Date(Date.now() + PROJECT_API_KEY_PLAINTEXT_GRACE_MS / 2),
        });

        expect((await storedKey(projectId)).apiKey).toBe(token);
      });
    });

    describe("when the sweep runs after the grace window", () => {
      /** @scenario "A key authenticates after its plaintext was cleared" */
      it("clears the plaintext and the key keeps authenticating", async () => {
        const { token, projectId } = await createPlaintextProject();
        await sweep();

        await sweep({
          now: new Date(Date.now() + PROJECT_API_KEY_PLAINTEXT_GRACE_MS + 1),
        });

        const stored = await storedKey(projectId);
        expect(stored.apiKey).toBeNull();
        expect(stored.apiKeyHash).toBe(hashProjectApiKey(token));
        const resolved = await resolver.resolve({ token });
        expect(resolved?.type).toBe("legacyProjectKey");
        expect(resolved?.project.id).toBe(projectId);
        expect((await validateOverHttp(token)).status).toBe(200);
      });
    });

    describe("when the previous release rotates it after it was hashed", () => {
      /** @scenario "A rotation made by the previous release retires the old key" */
      it("refuses the old key and authenticates the new one", async () => {
        const { token: oldToken, projectId } = await createPlaintextProject();
        await sweep();
        // The previous release rotates by writing the new plaintext only,
        // which leaves the old key's hash on the row.
        const newToken = generateApiKey();
        await prisma.project.update({
          where: { id: projectId },
          data: { apiKey: newToken },
        });

        expect(await resolver.resolve({ token: oldToken })).toBeNull();
        const resolvedNew = await resolver.resolve({ token: newToken });
        expect(resolvedNew?.project.id).toBe(projectId);
        expect((await storedKey(projectId)).apiKeyHash).toBe(
          hashProjectApiKey(newToken),
        );
      });

      it("never clears the new plaintext while the stored hash is stale", async () => {
        const { projectId } = await createPlaintextProject();
        await sweep();
        const newToken = generateApiKey();
        await prisma.project.update({
          where: { id: projectId },
          data: { apiKey: newToken },
        });

        await sweep({
          now: new Date(Date.now() + PROJECT_API_KEY_PLAINTEXT_GRACE_MS + 1),
        });

        const stored = await storedKey(projectId);
        expect(stored.apiKey).toBe(newToken);
        expect(stored.apiKeyHash).toBe(hashProjectApiKey(newToken));
      });
    });
  });

  describe("given an API key a person minted for one project", () => {
    /** @scenario "The Python SDK login accepts the key a person mints for one project" */
    it("validates over HTTP for the SDK login and names that project", async () => {
      const { projectId } = await createPlaintextProject();
      const user = await prisma.user.create({
        data: { name: "SDK Login", email: `${ns}-sdk-login@example.com` },
      });
      await prisma.organizationUser.create({
        data: {
          organizationId,
          userId: user.id,
          role: OrganizationUserRole.MEMBER,
        },
      });
      await seedRoleBinding(prisma, {
        organizationId,
        userId: user.id,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.PROJECT,
        scopeId: projectId,
      });
      const { token } = await ApiKeyService.create(prisma).create({
        name: "SDK login",
        userId: user.id,
        createdByUserId: user.id,
        organizationId,
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.MEMBER,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: projectId,
          },
        ],
      });

      const res = await validateOverHttp(token);

      expect(res.status).toBe(200);
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { slug: true },
      });
      expect(await res.json()).toEqual({ projectSlug: project.slug });
    });
  });

  describe("given keys that must not authenticate", () => {
    /** @scenario "A wrong key is refused" */
    it("refuses a key that belongs to no project", async () => {
      expect(await resolver.resolve({ token: generateApiKey() })).toBeNull();
      expect((await validateOverHttp(generateApiKey())).status).toBe(401);
    });

    /** @scenario "A key of an archived project is refused" */
    it("refuses the key of an archived project, hashed or not", async () => {
      const plaintext = await createPlaintextProject();
      const hashed = await createPlaintextProject();
      await sweep();
      await prisma.project.updateMany({
        where: { id: { in: [plaintext.projectId, hashed.projectId] } },
        data: { archivedAt: new Date() },
      });

      expect(await resolver.resolve({ token: plaintext.token })).toBeNull();
      expect(await resolver.resolve({ token: hashed.token })).toBeNull();
    });
  });

  describe("given a project created with a minted key", () => {
    /** @scenario "A new project stores only the hash of its key" */
    it("stores the hash and last four characters, no plaintext, and authenticates", async () => {
      const { token, columns } = mintProjectApiKey();
      const project = await prisma.project.create({
        data: {
          name: "Minted Project",
          slug: `--test-project-${ns}-minted`,
          teamId,
          language: "en",
          framework: "test",
          ...columns,
        },
      });

      const stored = await storedKey(project.id);
      expect(stored.apiKey).toBeNull();
      expect(stored.apiKeyHash).toBe(hashProjectApiKey(token));
      expect(stored.apiKeyLast4).toBe(token.slice(-4));
      const resolved = await resolver.resolve({ token });
      expect(resolved?.project.id).toBe(project.id);
    });
  });

  describe("given a project internal key", () => {
    /** @scenario "The internal key authenticates as the project" */
    it("authenticates as the project", async () => {
      const { projectId } = await createPlaintextProject();

      const internalKey = await getProjectInternalKey({ prisma, projectId });

      const resolved = await resolver.resolve({ token: internalKey });
      expect(resolved?.type).toBe("legacyProjectKey");
      expect(resolved?.project.id).toBe(projectId);
    });

    /** @scenario "The internal key survives a rotation of the project API key" */
    it("keeps authenticating after the project API key is rotated", async () => {
      const { token, projectId } = await createPlaintextProject();
      const internalKey = await getProjectInternalKey({ prisma, projectId });

      await prisma.project.update({
        where: { id: projectId },
        data: mintProjectApiKey().columns,
      });

      expect(await resolver.resolve({ token })).toBeNull();
      expect(
        (await findProjectByApiKey({ prisma, token: internalKey }))?.id,
      ).toBe(projectId);
      expect(await getProjectInternalKey({ prisma, projectId })).toBe(
        internalKey,
      );
    });

    /** @scenario "Concurrent requests for the internal key get the same key" */
    it("hands concurrent callers the same key", async () => {
      const { projectId } = await createPlaintextProject();

      const keys = await Promise.all(
        Array.from({ length: 5 }, () =>
          getProjectInternalKey({ prisma, projectId }),
        ),
      );

      expect(new Set(keys).size).toBe(1);
      const stored = await prisma.projectInternalKey.findUniqueOrThrow({
        where: { projectId },
      });
      expect(stored.tokenHash).toBe(hashProjectApiKey(keys[0]!));
      expect(stored.tokenEncrypted).not.toContain(keys[0]!);
    });

    it("is not the project API key", async () => {
      const { token, projectId } = await createPlaintextProject();

      expect(await getProjectInternalKey({ prisma, projectId })).not.toBe(
        token,
      );
    });
  });
});
