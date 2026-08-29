/**
 * @vitest-environment node
 *
 * REST coverage for /api/agent-cache. Real Postgres, real Prisma, real Hono
 * pipeline, and the cache's own in-process store.
 *
 * Spec: specs/agent-cache/agent-cache.feature
 */

import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPromptsRestApp } from "~/server/api/prompts-rest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { mintAgentSandboxApiKey } from "~/server/api-key/agent-sandbox-key";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createAgentCacheRestApp, MAX_VALUE_BYTES } from "@langwatch/platform-api";
import { appRestSecurity } from "~/server/api/security";
import { AgentCacheService } from "../agent-cache.service";

/**
 * The same wiring `api-router.ts` mounts: the family, built against this
 * process's security and its one entry store.
 */
const agentCacheService = new AgentCacheService();
const { hono: app } = createAgentCacheRestApp({
  security: appRestSecurity,
  agentCache: () => agentCacheService,
});

wireDefaultTestApp();

/** The prompts family as the API router mounts it. */
const promptsApp = buildPromptsRestApp(() => getApp().prompts.promptService);

const ENTRY_NAME = "ACME_SESSION";
const ENTRY_VALUE = '{"session":"session-1"}';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Feature: the agent cache", () => {
  const ns = `agent-cache-${nanoid(8)}`;

  let testOrganization: Organization;
  let testTeam: Team;
  let projectId: string;
  let projectApiKey: string;
  let manageToken: string;
  let viewerToken: string;
  let sandboxToken: string;
  let userId: string;

  const headersFor = (token: string) => ({
    Authorization: `Bearer ${token}`,
    "X-Project-Id": projectId,
  });

  const readEntry = (name: string, token: string) =>
    app.request(`/api/agent-cache/${name}`, { headers: headersFor(token) });

  const writeEntry = (name: string, token: string, body: Record<string, unknown>) =>
    app.request(`/api/agent-cache/${name}`, {
      method: "PUT",
      headers: { ...headersFor(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const claimEntry = (name: string, token: string, body: Record<string, unknown>) =>
    app.request(`/api/agent-cache/${name}/claim`, {
      method: "POST",
      headers: { ...headersFor(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const removeEntry = (name: string, token: string) =>
    app.request(`/api/agent-cache/${name}`, {
      method: "DELETE",
      headers: headersFor(token),
    });

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Agent Cache Org", slug: `--test-org-${ns}` },
    });
    testTeam = await prisma.team.create({
      data: {
        name: "Agent Cache Team",
        slug: `--test-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });

    const user = await prisma.user.create({
      data: { name: "Test User", email: `test-${ns}@example.com` },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: { userId, teamId: testTeam.id, role: TeamUserRole.ADMIN },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: testOrganization.id,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrganization.id,
      },
    });

    projectApiKey = `sk-lw-${nanoid(48)}`;
    const project = await prisma.project.create({
      data: {
        id: `project_${nanoid()}`,
        name: "Agent Cache Project",
        slug: `--test-project-${ns}`,
        language: "typescript",
        framework: "other",
        apiKey: projectApiKey,
        teamId: testTeam.id,
      },
    });
    projectId = project.id;

    const apiKeyService = getApp().apiKeys;
    manageToken = (
      await apiKeyService.create({
        name: `agent-cache-manage-${nanoid(6)}`,
        userId,
        createdByUserId: userId,
        organizationId: testOrganization.id,
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;

    // A VIEWER binding resolves no agent-cache grain at all, which is the
    // caller every route here has to refuse.
    viewerToken = (
      await apiKeyService.create({
        name: `agent-cache-viewer-${nanoid(6)}`,
        userId,
        createdByUserId: userId,
        organizationId: testOrganization.id,
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;

    sandboxToken = await mintAgentSandboxApiKey({
      apiKeys: getApp().apiKeys.apiKeyService,
      projectId,
      organizationId: testOrganization.id,
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId: testOrganization.id }],
      ["apiKey", { organizationId: testOrganization.id }],
      // The sandbox key is a restricted key, so its grants live in a custom
      // role the organization owns.
      ["customRole", { organizationId: testOrganization.id }],
      ["project", { id: projectId }],
      ["teamUser", { teamId: testTeam.id }],
      ["organizationUser", { organizationId: testOrganization.id }],
      ["team", { id: testTeam.id }],
      ["organization", { id: testOrganization.id }],
      ["user", { id: userId }],
    ]);
  });

  describe("given a caller that can manage the agent cache", () => {
    describe("when it stores a value and reads it back", () => {
      /** @scenario "A stored entry is read back by its name" */
      it("answers the value that was stored", async () => {
        const written = await writeEntry(ENTRY_NAME, manageToken, {
          value: ENTRY_VALUE,
        });
        expect(written.status).toBe(200);

        const res = await readEntry(ENTRY_NAME, manageToken);
        expect(res.status).toBe(200);
        expect((await res.json()) as unknown).toEqual({
          name: ENTRY_NAME,
          value: ENTRY_VALUE,
        });
      });

      /** @scenario "A second write replaces the entry" */
      it("replaces the value on the second write", async () => {
        await writeEntry("ACME_REPLACED", manageToken, { value: "first" });
        await writeEntry("ACME_REPLACED", manageToken, { value: "second" });

        const res = await readEntry("ACME_REPLACED", manageToken);
        expect(((await res.json()) as { value: string }).value).toBe("second");
      });
    });

    describe("when the entry's lifetime passes", () => {
      /** @scenario "An entry stops answering once its lifetime passes" */
      it("answers a read after the lifetime as a miss", async () => {
        await writeEntry("ACME_BRIEF", manageToken, {
          value: "gone-soon",
          ttl_seconds: 5,
        });
        expect((await readEntry("ACME_BRIEF", manageToken)).status).toBe(200);

        // The route floor is 5 seconds; the in-memory store expires on a
        // wall-clock read, so waiting past it is the only way to observe it.
        await sleep(5_100);

        const res = await readEntry("ACME_BRIEF", manageToken);
        expect(res.status).toBe(404);
      }, 15_000);
    });

    describe("when it reads a name the project does not hold", () => {
      /** @scenario "A name the project does not hold is refused as not found" */
      it("refuses with the cache_entry_not_found code", async () => {
        const res = await readEntry("ACME_NEVER_STORED", manageToken);
        expect(res.status).toBe(404);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
          "cache_entry_not_found",
        );
      });
    });

    describe("when it removes an entry", () => {
      /** @scenario "Removing an entry the project does not hold succeeds" */
      it("succeeds whether or not the name was held", async () => {
        await writeEntry("ACME_DROPPED", manageToken, { value: "x" });
        expect((await removeEntry("ACME_DROPPED", manageToken)).status).toBe(200);
        expect((await readEntry("ACME_DROPPED", manageToken)).status).toBe(404);
        expect((await removeEntry("ACME_DROPPED", manageToken)).status).toBe(200);
      });
    });

    describe("when the request is outside the accepted bounds", () => {
      /** @scenario "A value past the size limit is refused" */
      it("refuses a value past the size limit", async () => {
        const res = await writeEntry("ACME_TOO_BIG", manageToken, {
          value: "x".repeat(MAX_VALUE_BYTES + 1),
        });
        expect(res.status).toBe(400);
      });

      /** @scenario "A name outside the accepted shape is refused" */
      it("refuses a name outside the accepted shape", async () => {
        const res = await readEntry("acme-session", manageToken);
        expect(res.status).toBe(400);
      });

      /** @scenario "A lifetime outside the accepted range is refused" */
      it("refuses a lifetime outside the accepted range", async () => {
        const res = await writeEntry("ACME_LONG", manageToken, {
          value: "x",
          ttl_seconds: 1,
        });
        expect(res.status).toBe(400);
      });
    });
  });

  describe("given a caller that takes a name with a claim", () => {
    describe("when the project holds no entry under that name", () => {
      /** @scenario "A claim on a free name is taken" */
      it("takes the name and stores the value", async () => {
        const res = await claimEntry("ACME_CLAIM_FREE", manageToken, {
          value: "won-it",
        });
        expect(res.status).toBe(200);
        expect((await res.json()) as unknown).toMatchObject({
          name: "ACME_CLAIM_FREE",
          claimed: true,
        });

        const read = await readEntry("ACME_CLAIM_FREE", manageToken);
        expect(((await read.json()) as { value: string }).value).toBe("won-it");
      });
    });

    describe("when the project already holds that name", () => {
      /** @scenario "A claim on a held name leaves the held value alone" */
      it("does not take the name and leaves the held value alone", async () => {
        await writeEntry("ACME_CLAIM_HELD", manageToken, { value: "first" });

        const res = await claimEntry("ACME_CLAIM_HELD", manageToken, {
          value: "second",
        });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { claimed: boolean }).claimed).toBe(false);

        const read = await readEntry("ACME_CLAIM_HELD", manageToken);
        expect(((await read.json()) as { value: string }).value).toBe("first");
      });
    });

    describe("when the claimed entry's lifetime passes", () => {
      /** @scenario "A name is free again once its lifetime passes" */
      it("lets the next caller take the name", async () => {
        const first = await claimEntry("ACME_CLAIM_BRIEF", manageToken, {
          value: "gone-soon",
          ttl_seconds: 5,
        });
        expect(((await first.json()) as { claimed: boolean }).claimed).toBe(true);

        // The route floor is 5 seconds, so waiting past it is the only way to
        // observe the name coming free again.
        await sleep(5_100);

        const second = await claimEntry("ACME_CLAIM_BRIEF", manageToken, {
          value: "the-next-one",
        });
        expect(((await second.json()) as { claimed: boolean }).claimed).toBe(true);
      }, 15_000);
    });

    describe("when several callers claim the same name at once", () => {
      /** @scenario "Only one of several claims sent at once takes the name" */
      it("takes the name exactly once", async () => {
        const responses = await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            claimEntry("ACME_CLAIM_RACE", manageToken, {
              value: `row-${index}`,
            }),
          ),
        );

        const outcomes = await Promise.all(
          responses.map((res) => res.json() as Promise<{ claimed: boolean }>),
        );
        const winners = outcomes.filter((outcome) => outcome.claimed);
        expect(winners).toHaveLength(1);

        const winnerIndex = outcomes.findIndex((outcome) => outcome.claimed);
        const read = await readEntry("ACME_CLAIM_RACE", manageToken);
        expect(((await read.json()) as { value: string }).value).toBe(`row-${winnerIndex}`);
      });
    });
  });

  describe("given a legacy project API key", () => {
    describe("when it writes an entry and reads it back", () => {
      /** @scenario "A legacy project key reaches the agent cache" */
      it("reaches the cache, the same as the rest of the project surface", async () => {
        const written = await app.request(`/api/agent-cache/ACME_LEGACY`, {
          method: "PUT",
          headers: {
            "X-Auth-Token": projectApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ value: "from-the-legacy-key" }),
        });
        expect(written.status).toBe(200);

        const res = await app.request(`/api/agent-cache/ACME_LEGACY`, {
          headers: { "X-Auth-Token": projectApiKey },
        });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { value: string }).value).toBe("from-the-legacy-key");
      });
    });
  });

  describe("given a caller that cannot manage the agent cache", () => {
    describe("when a viewer reads and writes an entry", () => {
      /** @scenario "A caller without the manage grain is refused" */
      it("refuses a viewer", async () => {
        expect((await readEntry(ENTRY_NAME, viewerToken)).status).toBe(403);
        expect((await writeEntry(ENTRY_NAME, viewerToken, { value: "x" })).status).toBe(403);
      });
    });

    describe("when the request carries no API key", () => {
      /** @scenario "A request without an API key is refused" */
      it("refuses a request that carries no API key", async () => {
        const res = await app.request(`/api/agent-cache/${ENTRY_NAME}`, {
          headers: { "X-Project-Id": projectId },
        });
        expect(res.status).toBe(401);
      });
    });
  });

  describe("given the key a run puts in the sandbox", () => {
    describe("when it writes an entry and reads it back", () => {
      /** @scenario "The sandbox key reaches the agent cache" */
      it("reaches the agent cache", async () => {
        const written = await writeEntry("ACME_FROM_SANDBOX", sandboxToken, {
          value: "written-in-the-sandbox",
        });
        expect(written.status).toBe(200);

        const res = await readEntry("ACME_FROM_SANDBOX", sandboxToken);
        expect(res.status).toBe(200);
        expect(((await res.json()) as { value: string }).value).toBe("written-in-the-sandbox");
      });
    });

    describe("when it calls another route of the same project", () => {
      /** @scenario "The sandbox key reaches nothing else" */
      it("is refused everywhere else in the project", async () => {
        const res = await promptsApp.request("/api/prompts", {
          headers: headersFor(sandboxToken),
        });
        expect(res.status).toBe(403);
      });
    });
  });
});
