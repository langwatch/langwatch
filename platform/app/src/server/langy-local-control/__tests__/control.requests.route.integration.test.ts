/**
 * @vitest-environment node
 *
 * The device-session half of local control over its real REST family:
 * `GET /api/v1/langy/control/requests`, the approval that mints the session
 * key, the cancel, and the long-poll transport's answer to a token it does not
 * know. Real Postgres, the real auth middleware, the real key mint.
 *
 * @see specs/langy/langy-local-control.feature
 */

import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "~/app/api/langy-control/[[...route]]/app";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { INSTANCE_TOKEN_HEADER } from "~/server/connected-agents/long-poll.transport";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { KSUID_RESOURCES } from "~/utils/constants";
import { closeLocalControlRuntime, getLocalControlRuntime } from "../runtime";

wireDefaultTestApp();

const ns = `control-routes-${nanoid(8)}`;

let organization: Organization;
let team: Team;
let projectId: string;
let userId: string;
let mateId: string;
/** The developer's own key, the one `langwatch langy` is signed in with. */
let ownToken: string;
/** A teammate's key on the same project. */
let mateToken: string;

const conversationId = `conv_${nanoid(10)}`;

/** The Basic credential the command line sends: project id and the key. */
function basic(token: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${projectId}:${token}`).toString(
      "base64",
    )}`,
    "Content-Type": "application/json",
  };
}

async function openRequest() {
  return getLocalControlRuntime().requests.create({
    projectId,
    projectName: "Control Routes Project",
    userId,
    conversationId,
    conversationTitle: "Instrument tracing",
    conversationUrl: `/?langyConversation=${conversationId}`,
  });
}

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: "Control Routes Org", slug: `--test-org-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: "Control Routes Team",
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });
  const owner = await prisma.user.create({
    data: { name: "Rogerio", email: `owner-${ns}@example.com` },
  });
  const mate = await prisma.user.create({
    data: { name: "Teammate", email: `mate-${ns}@example.com` },
  });
  userId = owner.id;
  mateId = mate.id;
  for (const id of [userId, mateId]) {
    await prisma.organizationUser.create({
      data: {
        userId: id,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: { userId: id, teamId: team.id, role: TeamUserRole.ADMIN },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: organization.id,
        userId: id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organization.id,
      },
    });
  }
  const project = await prisma.project.create({
    data: {
      id: `project_${nanoid()}`,
      name: "Control Routes Project",
      slug: `--test-project-${ns}`,
      language: "typescript",
      framework: "other",
      apiKey: `sk-lw-${nanoid(48)}`,
      teamId: team.id,
    },
  });
  projectId = project.id;

  const apiKeys = ApiKeyService.create(prisma);
  const orgAdmin = {
    role: TeamUserRole.ADMIN,
    scopeType: RoleBindingScopeType.ORGANIZATION,
    scopeId: organization.id,
  };
  ownToken = (
    await apiKeys.create({
      name: `own-${ns}`,
      userId,
      createdByUserId: userId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [orgAdmin],
    })
  ).token;
  mateToken = (
    await apiKeys.create({
      name: `mate-${ns}`,
      userId: mateId,
      createdByUserId: mateId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [orgAdmin],
    })
  ).token;
});

afterAll(async () => {
  await closeLocalControlRuntime();
  await cleanupTestRows(prisma, [
    ["roleBinding", { organizationId: organization.id }],
    ["customRole", { organizationId: organization.id }],
    ["apiKey", { organizationId: organization.id }],
    ["project", { teamId: team.id }],
    ["teamUser", { teamId: team.id }],
    ["team", { id: team.id }],
    ["organizationUser", { organizationId: organization.id }],
    ["organization", { id: organization.id }],
    ["user", { id: userId }],
    ["user", { id: mateId }],
  ]);
});

describe("given a control request Langy opened for me", () => {
  describe("when the command line lists the open requests", () => {
    /** @scenario "Choosing the local folder records a request the CLI can find" */
    it("shows mine with the conversation it belongs to", async () => {
      const request = await openRequest();
      const response = await app.request("/api/v1/langy/control/requests", {
        headers: basic(ownToken),
      });
      const body = (await response.json()) as {
        requests: { id: string; conversationId: string; expiresAt: string }[];
      };

      expect(response.status).toBe(200);
      expect(body.requests).toContainEqual(
        expect.objectContaining({
          id: request.id,
          conversationId,
          conversationTitle: "Instrument tracing",
        }),
      );
    });

    /** @scenario "Another user never sees my request" */
    it("shows a teammate none of mine, and refuses their approval", async () => {
      const request = await openRequest();
      const listed = await app.request("/api/v1/langy/control/requests", {
        headers: basic(mateToken),
      });
      const body = (await listed.json()) as { requests: { id: string }[] };
      expect(body.requests.map((row) => row.id)).not.toContain(request.id);

      const approved = await app.request(
        `/api/v1/langy/control/requests/${request.id}/approve`,
        {
          method: "POST",
          headers: basic(mateToken),
          body: JSON.stringify({ workspace: workspace() }),
        },
      );
      expect(approved.status).toBe(404);
      expect(await refusalOf(approved)).toMatchObject({
        code: "langy_local_request_invalid",
        // The canonical envelope ships the code as `message` and the prose the
        // terminal prints as `tips` (ADR-045).
        message: "langy_local_request_invalid",
        tips: expect.arrayContaining([expect.stringContaining("approve")]),
      });
    });
  });

  describe("when the developer approves it in the terminal", () => {
    /** @scenario "Approving a request mints a session key for the conversation" */
    it("answers with the session key and refuses a second approval", async () => {
      const request = await openRequest();
      const response = await app.request(
        `/api/v1/langy/control/requests/${request.id}/approve`,
        {
          method: "POST",
          headers: basic(ownToken),
          body: JSON.stringify({ workspace: workspace() }),
        },
      );
      const body = (await response.json()) as {
        sessionKey: string;
        conversation: { id: string; url: string };
      };

      expect(response.status).toBe(200);
      expect(body.sessionKey).toMatch(/^sk-lw-/);
      expect(body.conversation.id).toBe(conversationId);

      const again = await app.request(
        `/api/v1/langy/control/requests/${request.id}/approve`,
        {
          method: "POST",
          headers: basic(ownToken),
          body: JSON.stringify({ workspace: workspace() }),
        },
      );
      expect(again.status).toBe(404);
    });
  });

  describe("when the developer refuses it in the terminal", () => {
    /** @scenario "Cancelling a request from the terminal closes the card" */
    it("drops the request, so nothing is left to approve", async () => {
      const request = await openRequest();
      const response = await app.request(
        `/api/v1/langy/control/requests/${request.id}/cancel`,
        { method: "POST", headers: basic(ownToken) },
      );

      expect(response.status).toBe(200);
      expect(
        await getLocalControlRuntime().requests.read(request.id),
      ).toBeNull();
    });
  });
});

describe("given a network that blocks WebSockets", () => {
  describe("when the command line polls with a token nobody knows", () => {
    /** @scenario "The connection survives a network blip" */
    it("answers 410, which is what sends it back to sharing again", async () => {
      const response = await app.request("/api/v1/langy/control/connect/poll", {
        headers: {
          ...basic(ownToken),
          [INSTANCE_TOKEN_HEADER]: "lcs_nobody",
        },
      });

      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ frames: [] });
    });
  });
});

/** The register frame's environment checklist, as the approval carries it. */
function workspace() {
  return {
    root: "/Users/dev/acme-app",
    name: "acme-app",
    gitBranch: "main",
    os: "darwin",
  };
}

/** The refusal body of the canonical envelope: a code, and tips to print. */
async function refusalOf(response: Response): Promise<{
  code: string;
  message: string;
  tips?: string[];
}> {
  return (await response.json()) as {
    code: string;
    message: string;
    tips?: string[];
  };
}
