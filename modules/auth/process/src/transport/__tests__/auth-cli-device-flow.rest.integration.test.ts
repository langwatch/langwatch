/**
 * @vitest-environment node
 * The RFC 8628 CLI device grant end to end, over the real session service.
 * @see specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
import {
  ApiKeyScopeViolationError,
  cliKeyManagementPermissions,
} from "@langwatch/api-key-contract";
import { createRestRuntime } from "@langwatch/api/rest";
import { CliSessionRecordNotFoundError, cliRefreshTokenKey } from "@langwatch/auth-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { UserNotFoundError } from "@langwatch/user-contract";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { AuthDirectory } from "../../app/auth.members.ts";
import { MemoryCliDeviceSettlementChannel } from "../../channels/memory/memory.cli-device-settlement.channel.ts";
import type { CliDeviceSessionRepository } from "../../repositories/cli-device-session.repository.ts";
import {
  CliDeviceFlowService,
  type CliDeviceFlowCollaborators,
} from "../../services/cli-device-flow.service.ts";
import {
  CliDeviceSessionService,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
} from "../../services/cli-device-session.service.ts";
import { authCliDeviceFlowRest, type AuthCliDeviceFlowApi } from "../auth-cli-device-flow.rest.ts";

const USER_ID = "user-1";
const ORGANIZATION_ID = "org-1";
const REFRESH_WINDOW_MS = DEFAULT_REFRESH_TOKEN_TTL_SECONDS * 1000;
const deviceGrantSchema = z.object({ device_code: z.string(), user_code: z.string() });
const MANAGEMENT_PERMISSIONS: readonly string[] = cliKeyManagementPermissions();

/** A key selection that reaches the whole organization, as the approval screen sends it. */
const organizationKey = {
  bindings: [{ scope_type: "ORGANIZATION", scope_id: ORGANIZATION_ID }],
  permissions: ["traces:view"],
};

describe("given a CLI starting a device login", () => {
  describe("when the browser approves it and the CLI polls", () => {
    it("mints a session carrying the personal project and the scoped CLI key", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);

      const started = await api.post("/api/auth/cli/device-code", {});

      expect(started.status).toBe(200);

      const grant = (await started.json()) as {
        device_code: string;
        user_code: string;
        verification_uri: string;
        interval: number;
      };

      expect(grant.verification_uri).toBe("https://app.test/cli/auth");
      expect(grant.interval).toBe(5);

      const looked = await api.get(
        `/api/auth/cli/lookup?user_code=${encodeURIComponent(grant.user_code)}`,
      );

      expect(looked.status).toBe(200);
      await expect(looked.json()).resolves.toMatchObject({
        user_code: grant.user_code,
        status: "pending",
        credential_type: "device_session",
      });

      const approved = await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });

      expect(approved.status).toBe(200);
      await expect(approved.json()).resolves.toEqual({
        ok: true,
        organization_id: ORGANIZATION_ID,
      });
      // Approval proves identity and stamps the selection. It mints nothing:
      // an approval never exchanged must leave no credential behind.
      expect(world.mintedKeys).toEqual([]);

      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
        client_info: { hostname: "Bobs-MacBook-Pro" },
      });

      expect(exchanged.status).toBe(200);

      const session = (await exchanged.json()) as Record<string, unknown>;

      expect(session.kind).toBe("device_session");
      expect(session.access_token).toMatch(/^lw_at_/);
      expect(session.refresh_token).toMatch(/^lw_rt_/);
      expect(session.endpoint).toBe("https://app.test");
      expect(session.personal_project).toEqual({
        id: "project-personal",
        slug: "personal-bob",
        name: "Bob",
      });
      expect(session.cli_api_key).toBe("lw_cli_minted");
      // The hostname is normalized on the way into the key name: an
      // unnormalized value would fail to match the previous login key on the
      // next login and leave credentials accumulating.
      expect(world.mintedKeys).toEqual([{ deviceLabel: "bobs-macbook-pro", userId: USER_ID }]);
    });
  });

  describe("when the CLI polls again inside the interval", () => {
    it("answers slow_down rather than reading the record a second time", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
      };

      const first = await api.post("/api/auth/cli/exchange", { device_code: grant.device_code });

      expect(first.status).toBe(428);

      const second = await api.post("/api/auth/cli/exchange", { device_code: grant.device_code });

      expect(second.status).toBe(429);
      await expect(second.json()).resolves.toMatchObject({ error: "slow_down" });
    });
  });

  describe("when the CLI polls a settled code inside the interval", () => {
    /** @scenario A poll on a settled device code is answered, not rate limited */
    it("answers the settled outcome instead of slow_down", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };

      const pending = await api.post("/api/auth/cli/exchange", { device_code: grant.device_code });

      expect(pending.status).toBe(428);

      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });
      const settled = await api.post("/api/auth/cli/exchange", { device_code: grant.device_code });

      expect(settled.status).toBe(200);
    });
  });

  describe("when the CLI waits on the approval stream", () => {
    const approvalOf = (api: ReturnType<typeof mount>, deviceCode: string) =>
      api.get(`/api/auth/cli/device-approval?device_code=${encodeURIComponent(deviceCode)}`);

    /** @scenario The approval stream tells the CLI to poll the moment the browser settles the code */
    it("emits the approval of a code that was pending when the stream opened", async () => {
      const api = mount(deviceFlowWorld());
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };

      const stream = await approvalOf(api, grant.device_code);
      const frames = stream.text();
      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });

      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type")).toContain("text/event-stream");
      expect(await frames).toBe(`data: ${JSON.stringify({ status: "approved" })}\n\n`);
    });

    it("emits a code denied before the stream opened at once", async () => {
      const api = mount(deviceFlowWorld());
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };
      await api.post("/api/auth/cli/deny", { user_code: grant.user_code });

      const stream = await approvalOf(api, grant.device_code);

      expect(await stream.text()).toBe(`data: ${JSON.stringify({ status: "denied" })}\n\n`);
    });

    it("reports an unknown code as expired rather than holding the stream open", async () => {
      const api = mount(deviceFlowWorld());

      const stream = await approvalOf(api, "never-minted");

      expect(await stream.text()).toBe(`data: ${JSON.stringify({ status: "expired" })}\n\n`);
    });
  });

  describe("when the approver's seat is disabled between approve and exchange", () => {
    it("burns the device code and answers the one code the CLI treats as fatal", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };

      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });
      world.activeMembership = false;

      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });

      expect(exchanged.status).toBe(410);
      await expect(exchanged.json()).resolves.toMatchObject({ error: "access_denied" });
      expect(world.mintedKeys).toEqual([]);

      // The device code is gone, so the next poll learns the grant is over
      // rather than that it polled too soon.
      const polled = await api.post("/api/auth/cli/exchange", { device_code: grant.device_code });

      expect(polled.status).toBe(408);
    });
  });

  describe("when an approve request claims a binding above the caller's ceiling", () => {
    /** @scenario "approve refuses bindings above the approving user's ceiling" */
    it("refuses the approval with a handled scope-violation error", async () => {
      const world = deviceFlowWorld({
        validateSelectionError: () => new ApiKeyScopeViolationError("binding exceeds ceiling"),
      });
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        user_code: string;
      };

      const refused = await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
        key_selection: {
          bindings: [{ scope_type: "ORGANIZATION", scope_id: ORGANIZATION_ID }],
          permissions: ["traces:view"],
        },
      });

      expect(refused.status).toBe(403);
      await expect(refused.json()).resolves.toMatchObject({ error: "api_key_scope_violation" });
    });
  });

  describe("when the CLI asked for management access with --management", () => {
    const startWithManagement = async (api: ReturnType<typeof mount>) =>
      (await (await api.post("/api/auth/cli/device-code", { management: true })).json()) as {
        device_code: string;
        user_code: string;
      };

    /** @scenario The approval screen shows management access when the CLI asked for it */
    it("tells the approval page, and stamps every management permission an admin holds", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);
      const grant = await startWithManagement(api);

      const looked = await api.get(
        `/api/auth/cli/lookup?user_code=${encodeURIComponent(grant.user_code)}`,
      );
      await expect(looked.json()).resolves.toMatchObject({ management: true });

      const approved = await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
        key_selection: organizationKey,
      });

      expect(approved.status).toBe(200);
      expect(world.validatedSelections.at(-1)?.permissions).toEqual([
        "traces:view",
        "organization:manage",
        "team:manage",
      ]);
      expect(world.validatedSelections.at(-1)?.permissions).not.toContain("organization:delete");
    });

    describe("and the approver holds only some of the management permissions", () => {
      /** @scenario Management access grants only the management permissions the user holds */
      it("stamps the ones they hold and leaves the rest out", async () => {
        const world = deviceFlowWorld({ heldManagement: ["team:manage"] });
        const api = mount(world);
        const grant = await startWithManagement(api);

        const approved = await api.post("/api/auth/cli/approve", {
          user_code: grant.user_code,
          organization_id: ORGANIZATION_ID,
          key_selection: organizationKey,
        });

        expect(approved.status).toBe(200);
        expect(world.validatedSelections.at(-1)?.permissions).toEqual([
          "traces:view",
          "team:manage",
        ]);
      });
    });

    describe("and the approver holds none of them", () => {
      /** @scenario Management access is refused to a user who holds no management permission */
      it("refuses the approval by name and stamps nothing", async () => {
        const world = deviceFlowWorld({ heldManagement: [] });
        const api = mount(world);
        const grant = await startWithManagement(api);

        const refused = await api.post("/api/auth/cli/approve", {
          user_code: grant.user_code,
          organization_id: ORGANIZATION_ID,
          key_selection: organizationKey,
        });

        expect(refused.status).toBe(403);
        await expect(refused.json()).resolves.toMatchObject({
          error: "management_not_permitted",
        });
        const exchanged = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });
        expect(exchanged.status).toBe(428);
        expect(world.mintedKeys).toEqual([]);
      });
    });

    describe("and the approval binds no organization scope", () => {
      it("refuses rather than quietly dropping management access", async () => {
        const world = deviceFlowWorld();
        const api = mount(world);
        const grant = await startWithManagement(api);

        const refused = await api.post("/api/auth/cli/approve", {
          user_code: grant.user_code,
          organization_id: ORGANIZATION_ID,
          key_selection: {
            bindings: [{ scope_type: "TEAM", scope_id: "team-1" }],
            permissions: ["traces:view"],
          },
        });

        expect(refused.status).toBe(400);
        await expect(refused.json()).resolves.toMatchObject({
          error: "management_needs_organization",
        });
      });

      describe("when the approval names no selection and the default key reaches no organization", () => {
        it("refuses rather than minting a key without management access", async () => {
          const world = deviceFlowWorld({
            defaultSelection: {
              bindings: [{ scopeType: "TEAM", scopeId: "team-1" }],
              permissions: ["traces:view"],
            },
          });
          const api = mount(world);
          const grant = await startWithManagement(api);

          const refused = await api.post("/api/auth/cli/approve", {
            user_code: grant.user_code,
            organization_id: ORGANIZATION_ID,
          });

          expect(refused.status).toBe(400);
          await expect(refused.json()).resolves.toMatchObject({
            error: "management_needs_organization",
          });
        });
      });
    });

    describe("and the approval names no selection", () => {
      it("adds the held management permissions to an organization-wide default key", async () => {
        const world = deviceFlowWorld({
          defaultSelection: {
            bindings: [{ scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID }],
            permissions: ["traces:view"],
          },
        });
        const api = mount(world);
        const grant = await startWithManagement(api);

        const approved = await api.post("/api/auth/cli/approve", {
          user_code: grant.user_code,
          organization_id: ORGANIZATION_ID,
        });

        expect(approved.status).toBe(200);
      });
    });
  });

  describe("when the CLI did not ask for management access", () => {
    /** @scenario A plain CLI login does not ask for management access */
    it("stamps the selection the page sent, without management permissions", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        user_code: string;
      };

      const looked = await api.get(
        `/api/auth/cli/lookup?user_code=${encodeURIComponent(grant.user_code)}`,
      );
      await expect(looked.json()).resolves.toMatchObject({ management: false });

      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
        key_selection: organizationKey,
      });

      expect(world.validatedSelections.at(-1)?.permissions).toEqual(["traces:view"]);
    });
  });

  describe("when the approver loses access between approve and exchange", () => {
    /** @scenario "access lost between approve and exchange ends the login" */
    it("answers a fatal access_denied and burns the device code", async () => {
      const world = deviceFlowWorld({
        mintError: () => new ApiKeyScopeViolationError("access changed since approval"),
      });
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };

      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });

      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });

      expect(exchanged.status).toBe(410);
      await expect(exchanged.json()).resolves.toMatchObject({ error: "access_denied" });
      expect(world.mintedKeys).toEqual([]);
    });
  });

  /**
   * The no-paste API-key journey. A device code lives ten minutes, so between
   * approval and the CLI polling for it an admin can revoke the role, archive
   * the project, or rotate its key — the approval stamp is a pointer, never the answer.
   */
  describe("given a project-key grant approved for a project the person administers", () => {
    async function approvedProjectKeyGrant(world: ReturnType<typeof deviceFlowWorld>) {
      const api = mount(world);
      const grant = (await (
        await api.post("/api/auth/cli/device-code", { credential_type: "project_api_key" })
      ).json()) as { device_code: string; user_code: string };

      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
        project_id: "project-shared",
      });

      return { api, grant };
    }

    describe("when the CLI polls after approval", () => {
      /** @scenario A project login answers tokens and the project, never a key */
      it("answers a project session and no key", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, grant } = await approvedProjectKeyGrant(world);

        const exchanged = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });
        const body = await exchanged.text();
        const session = JSON.parse(body) as Record<string, unknown>;

        expect(exchanged.status).toBe(200);
        expect(session.access_token).toMatch(/^lw_at_/);
        expect(session.refresh_token).toMatch(/^lw_rt_/);
        expect(session.expires_in).toEqual(expect.any(Number));
        expect(session.project).toEqual({ id: "project-shared", slug: "shared", name: "Shared" });
        expect(session).not.toHaveProperty("api_key");
        expect(body).not.toContain("sk-lw-shared");
      });
    });

    describe("when the session is re-scoped through a refresh", () => {
      async function projectSession(world: ReturnType<typeof deviceFlowWorld>) {
        const { api, grant } = await approvedProjectKeyGrant(world);
        const exchanged = (await (
          await api.post("/api/auth/cli/exchange", { device_code: grant.device_code })
        ).json()) as { refresh_token: string };

        return { api, refreshToken: exchanged.refresh_token };
      }

      /** @scenario Refresh naming another project forks a child session and keeps the parent */
      it("forks a pair locked to the named project and leaves the parent rotating", async () => {
        const world = deviceFlowWorld();
        const { api, refreshToken } = await personSession(world);

        world.project = liveProject({ id: "project-other", slug: "other", name: "Other" });
        const forked = await api.post("/api/auth/cli/refresh", {
          refresh_token: refreshToken,
          project_slug: "other",
        });

        expect(forked.status).toBe(200);
        await expect(forked.json()).resolves.toMatchObject({
          access_token: expect.stringMatching(/^lw_at_/),
          project: { id: "project-other", slug: "other", name: "Other" },
        });
        expect(
          world.store
            .dump()
            .some(
              (record) =>
                record.includes('"project_id":"project-other"') &&
                record.includes('"project_locked":true'),
            ),
        ).toBe(true);

        const parent = await api.post("/api/auth/cli/refresh", { refresh_token: refreshToken });

        expect(parent.status).toBe(200);
      });

      /** @scenario A project login is locked to the project the person approved */
      it("refuses to fork the session a project login answered", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, refreshToken } = await projectSession(world);

        world.project = liveProject({ id: "project-other", slug: "other", name: "Other" });
        const refused = await api.post("/api/auth/cli/refresh", {
          refresh_token: refreshToken,
          project_slug: "other",
        });

        expect(refused.status).toBe(403);
        world.project = liveProject();
        const kept = await api.post("/api/auth/cli/refresh", { refresh_token: refreshToken });

        expect(kept.status).toBe(200);
        await expect(kept.json()).resolves.toMatchObject({ project: { id: "project-shared" } });
      });

      /** @scenario Refresh is refused when the person cannot access the project */
      it("refuses a project the person cannot view and keeps the refresh token valid", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, refreshToken } = await projectSession(world);

        world.administersProject = false;
        const refused = await api.post("/api/auth/cli/refresh", {
          refresh_token: refreshToken,
          project_id: "project-shared",
        });

        expect(refused.status).toBe(403);
        await expect(refused.json()).resolves.toMatchObject({ error: "forbidden" });

        world.administersProject = true;
        const kept = await api.post("/api/auth/cli/refresh", { refresh_token: refreshToken });

        expect(kept.status).toBe(200);
      });
    });

    describe("when a session that forked a child ends", () => {
      async function forkedFamily(world: ReturnType<typeof deviceFlowWorld>) {
        const parent = await personSession(world);
        world.project = liveProject({ id: "project-other", slug: "other", name: "Other" });
        const child = (await (
          await parent.api.post("/api/auth/cli/refresh", {
            refresh_token: parent.refreshToken,
            project_slug: "other",
          })
        ).json()) as { refresh_token: string };

        return { ...parent, childRefreshToken: child.refresh_token };
      }

      /** @scenario Logging out a session ends the children forked from it */
      it("ends the child when the parent logs out", async () => {
        const world = deviceFlowWorld();
        const { api, accessToken, refreshToken, childRefreshToken } = await forkedFamily(world);

        await api.post("/api/auth/cli/logout", {
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        const child = await api.post("/api/auth/cli/refresh", { refresh_token: childRefreshToken });

        expect(child.status).toBe(401);
        await expect(child.json()).resolves.toMatchObject({ error: "invalid_grant" });
      });

      /** @scenario Revoking a session ends the children forked from it */
      it("ends the child when the parent's tokens are revoked", async () => {
        const world = deviceFlowWorld();
        const { api, refreshToken, childRefreshToken } = await forkedFamily(world);

        await world.sessions.revokeTokens({
          userId: USER_ID,
          tokenKeys: [cliRefreshTokenKey(refreshToken)],
        });
        const child = await api.post("/api/auth/cli/refresh", { refresh_token: childRefreshToken });

        expect(child.status).toBe(401);
      });
    });

    describe("when a rotation fails part-way on an unexpected error", () => {
      /** @scenario A rotation that fails part-way leaves the refresh token usable */
      it("hands the claim back, so the next presentation rotates", async () => {
        const world = deviceFlowWorld();
        const { api, refreshToken } = await personSession(world);

        world.directoryFails = true;
        const failed = await api.post("/api/auth/cli/refresh", { refresh_token: refreshToken });

        expect(failed.status).toBe(500);
        world.directoryFails = false;
        const retried = await api.post("/api/auth/cli/refresh", { refresh_token: refreshToken });

        expect(retried.status).toBe(200);
      });
    });

    describe("when one refresh token is presented twice at once", () => {
      /** @scenario A refresh token buys one rotation, even when presented twice at once */
      it("rotates once and refuses the second presentation as spent", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, grant } = await approvedProjectKeyGrant(world);
        const { refresh_token } = (await (
          await api.post("/api/auth/cli/exchange", { device_code: grant.device_code })
        ).json()) as { refresh_token: string };

        const answers = await Promise.all([
          api.post("/api/auth/cli/refresh", { refresh_token }),
          api.post("/api/auth/cli/refresh", { refresh_token }),
        ]);

        expect(answers.map((answer) => answer.status).toSorted((a, b) => a - b)).toEqual([
          200, 401,
        ]);
      });
    });

    describe("when a session another sign-in locked to one project is re-scoped", () => {
      /** @scenario A session consented to one project cannot be re-scoped to another */
      it("refuses the re-scope and keeps the session on its project", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const api = mount(world);
        const locked = await world.flow.issueProjectSession({
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          projectId: "project-shared",
          clientLabel: "Hosted MCP",
        });

        world.project = liveProject({ id: "project-other", slug: "other", name: "Other" });
        const refused = await api.post("/api/auth/cli/refresh", {
          refresh_token: locked.refreshToken,
          project_slug: "other",
        });

        expect(refused.status).toBe(403);
      });

      /** @scenario A project session is refused to a person who can no longer view the project */
      it("refuses to issue the session once the person cannot view the project", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        world.administersProject = false;

        await expect(
          world.flow.issueProjectSession({
            userId: USER_ID,
            organizationId: ORGANIZATION_ID,
            projectId: "project-shared",
            clientLabel: "Hosted MCP",
          }),
        ).rejects.toMatchObject({ refusal: { error: "access_denied" } });
      });

      /** @scenario Every sign-in path reads the issued session back through the auth operations */
      it("issues a locked session, rotates it, and refuses a token it never issued", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const issued = await world.flow.issueProjectSession({
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          projectId: "project-shared",
          clientLabel: "Hosted MCP",
        });

        const rotated = await world.flow.rotateSession({ refreshToken: issued.refreshToken });

        expect(rotated.accessToken).toMatch(/^lw_at_/);
        expect(rotated.refreshToken).not.toBe(issued.refreshToken);
        await expect(
          world.flow.rotateSession({ refreshToken: issued.refreshToken }),
        ).rejects.toMatchObject({ refusal: { error: "invalid_grant" } });
        await expect(
          world.flow.rotateSession({ refreshToken: "lw_rt_never_issued" }),
        ).rejects.toMatchObject({ refusal: { error: "invalid_grant" } });
      });
    });

    describe("when the person stops administering the project before the CLI polls", () => {
      /** @scenario project-login exchange rechecks administration after approval */
      it("answers a fatal access_denied and discloses no key", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, grant } = await approvedProjectKeyGrant(world);

        world.administersProject = false;

        const exchanged = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });

        expect(exchanged.status).toBe(410);

        const body = await exchanged.text();

        expect(JSON.parse(body)).toMatchObject({ error: "access_denied" });
        expect(body).not.toContain("sk-lw-shared");

        const polled = await api.post("/api/auth/cli/exchange", { device_code: grant.device_code });

        expect(polled.status).toBe(408);
      });
    });

    describe("when the person's seat is disabled before the CLI polls", () => {
      /** @scenario project-login exchange denies a member whose seat was disabled after approval */
      it("answers a fatal access_denied, discloses no key and consumes the code", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, grant } = await approvedProjectKeyGrant(world);

        world.activeMembership = false;

        const exchanged = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });
        const body = await exchanged.text();
        const polled = await api.post("/api/auth/cli/exchange", { device_code: grant.device_code });

        expect(exchanged.status).toBe(410);
        expect(JSON.parse(body)).toMatchObject({ error: "access_denied" });
        expect(body).not.toContain("sk-lw-shared");
        expect(polled.status).toBe(408);
      });
    });

    describe("when the project is archived before the CLI polls", () => {
      it("answers a fatal access_denied rather than the stamped key", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, grant } = await approvedProjectKeyGrant(world);

        world.project = null;

        const exchanged = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });

        expect(exchanged.status).toBe(410);
        await expect(exchanged.json()).resolves.toMatchObject({ error: "access_denied" });
      });
    });

    describe("when the project became somebody else's personal workspace", () => {
      it("refuses, because a personal project only backs its own owner's key", async () => {
        const world = deviceFlowWorld();
        world.project = liveProject();
        const { api, grant } = await approvedProjectKeyGrant(world);

        world.project = liveProject({ isPersonal: true, ownerUserId: "somebody-else" });

        const exchanged = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });

        expect(exchanged.status).toBe(410);
      });
    });
  });

  describe("when a member approves a project-key device code", () => {
    async function pendingProjectKeyCode(api: ReturnType<typeof mount>) {
      return (await (
        await api.post("/api/auth/cli/device-code", { credential_type: "project_api_key" })
      ).json()) as { device_code: string; user_code: string };
    }

    const approveProject = (
      api: ReturnType<typeof mount>,
      grant: { user_code: string },
      projectId: string,
    ) =>
      api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
        project_id: projectId,
      });

    /** @scenario project-login approval rejects another user's personal project id */
    it("refuses another user's personal project by name and discloses no key", async () => {
      const world = deviceFlowWorld();
      world.project = liveProject({
        id: "project-theirs",
        isPersonal: true,
        ownerUserId: "somebody-else",
        apiKey: "sk-lw-theirs",
      });
      const api = mount(world);
      const grant = await pendingProjectKeyCode(api);

      const approved = await approveProject(api, grant, "project-theirs");
      const body = await approved.text();

      expect(approved.status).toBe(400);
      expect(JSON.parse(body)).toMatchObject({ error: "personal_project_not_allowed" });
      expect(body).not.toContain("sk-lw-theirs");
    });

    /** @scenario project-login approval honours the caller's own explicitly picked personal project */
    it("honours the caller's own personal project, whose key the exchange then returns", async () => {
      const world = deviceFlowWorld();
      world.project = liveProject({
        id: "project-mine",
        isPersonal: true,
        ownerUserId: USER_ID,
        apiKey: "sk-lw-mine",
      });
      const api = mount(world);
      const grant = await pendingProjectKeyCode(api);

      const approved = await approveProject(api, grant, "project-mine");
      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });

      expect(approved.status).toBe(200);
      await expect(exchanged.json()).resolves.toMatchObject({
        project: { id: "project-mine" },
      });
    });

    /** @scenario project-login approval returns the shared project's key */
    it("approves a shared project, whose key the exchange then returns", async () => {
      const world = deviceFlowWorld();
      world.project = liveProject();
      const api = mount(world);
      const grant = await pendingProjectKeyCode(api);

      const approved = await approveProject(api, grant, "project-shared");
      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
      });

      expect(approved.status).toBe(200);
      await expect(approved.json()).resolves.toMatchObject({
        kind: "api_key",
        project: { id: "project-shared" },
      });
      await expect(exchanged.json()).resolves.toMatchObject({ project: { id: "project-shared" } });
    });

    /** @scenario project-login approval denies a project the caller cannot manage */
    it("refuses a shared project the caller does not administer and discloses no key", async () => {
      const world = deviceFlowWorld();
      world.project = liveProject();
      world.administersProject = false;
      const api = mount(world);
      const grant = await pendingProjectKeyCode(api);

      const approved = await approveProject(api, grant, "project-shared");
      const body = await approved.text();

      expect(approved.status).toBe(403);
      expect(JSON.parse(body)).toMatchObject({ error: "forbidden" });
      expect(body).not.toContain("sk-lw-shared");
    });

    /** @scenario owning a personal project does not replace project administration */
    it("still refuses the caller's own personal project when they cannot manage it", async () => {
      const world = deviceFlowWorld();
      world.project = liveProject({
        id: "project-mine",
        isPersonal: true,
        ownerUserId: USER_ID,
        apiKey: "sk-lw-mine",
      });
      world.administersProject = false;
      const api = mount(world);
      const grant = await pendingProjectKeyCode(api);

      const approved = await approveProject(api, grant, "project-mine");
      const body = await approved.text();

      expect(approved.status).toBe(403);
      expect(JSON.parse(body)).toMatchObject({ error: "forbidden" });
      expect(body).not.toContain("sk-lw-mine");
    });

    /** @scenario project-login approval denies a member whose seat has been disabled */
    it("refuses a member whose seat an admin disabled and discloses no key", async () => {
      const world = deviceFlowWorld();
      world.project = liveProject();
      world.activeMembership = false;
      const api = mount(world);
      const grant = await pendingProjectKeyCode(api);

      const approved = await approveProject(api, grant, "project-shared");
      const body = await approved.text();

      expect(approved.status).toBe(403);
      expect(JSON.parse(body)).toMatchObject({ error: "forbidden" });
      expect(body).not.toContain("sk-lw-shared");
    });
  });

  describe("when a member approves a device-session code", () => {
    const approveDeviceSession = async (world: ReturnType<typeof deviceFlowWorld>) => {
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        user_code: string;
      };

      return api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
        key_selection: organizationKey,
      });
    };

    /** @scenario device-session approval succeeds on a default installation */
    it("is not refused by the governance gate when the flag cannot be read", async () => {
      const world = deviceFlowWorld({ governanceFlag: () => Promise.reject(new Error("no flag")) });

      const approved = await approveDeviceSession(world);

      expect(approved.status).toBe(200);
      expect(world.mintedKeys).toEqual([]);
    });

    /** @scenario device-session approval is refused when governance is disabled */
    it("refuses with governance_required when the organization switched governance off", async () => {
      const world = deviceFlowWorld({ governanceFlag: () => Promise.resolve(false) });

      const approved = await approveDeviceSession(world);

      expect(approved.status).toBe(403);
      await expect(approved.json()).resolves.toMatchObject({ error: "governance_required" });
      expect(world.mintedKeys).toEqual([]);
    });

    /** @scenario device-session approval succeeds when governance is enabled */
    it("approves without minting any key when governance is enabled", async () => {
      const world = deviceFlowWorld({ governanceFlag: () => Promise.resolve(true) });

      const approved = await approveDeviceSession(world);

      expect(approved.status).toBe(200);
      expect(world.mintedKeys).toEqual([]);
    });
  });

  /**
   * The exclusive redemption claim. The poll window paces polls, not this: a
   * redemption slower than the window leaves the record readable by the next
   * poll, and a second redemption would hand out a second credential.
   */
  describe("given an approved device code being redeemed", () => {
    const claims = (world: ReturnType<typeof deviceFlowWorld>) =>
      world.store.keys().filter((key) => key.includes("claim:"));

    describe("when the redemption succeeds", () => {
      /** @scenario A successful exchange keeps its claim until it expires on its own */
      it("leaves the claim standing, so a slower concurrent poll cannot redeem it again", async () => {
        const world = deviceFlowWorld();
        const api = mount(world);
        const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
          device_code: string;
          user_code: string;
        };

        await api.post("/api/auth/cli/approve", {
          user_code: grant.user_code,
          organization_id: ORGANIZATION_ID,
        });
        expect(claims(world)).toEqual([]);

        expect(
          (await api.post("/api/auth/cli/exchange", { device_code: grant.device_code })).status,
        ).toBe(200);

        expect(claims(world)).toHaveLength(1);
      });
    });

    describe("when the redemption bought nothing", () => {
      /** @scenario A refused exchange releases the claim so the CLI can retry */
      it("gives the claim back, so the CLI's next poll is not told to slow down", async () => {
        const world = deviceFlowWorld();
        const api = mount(world);
        const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
          device_code: string;
          user_code: string;
        };

        await api.post("/api/auth/cli/approve", {
          user_code: grant.user_code,
          organization_id: ORGANIZATION_ID,
        });

        world.personExists = false;

        const refused = await api.post("/api/auth/cli/exchange", {
          device_code: grant.device_code,
        });

        expect(refused.status).toBe(500);
        expect(claims(world)).toEqual([]);
      });
    });
  });

  describe("when an admin disables the member's seat before the refresh token is used", () => {
    /** @scenario "a disabled member's session cannot be renewed" */
    it("refuses the rotation with 401 and issues no new token pair", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };

      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });

      const exchanged = (await (
        await api.post("/api/auth/cli/exchange", { device_code: grant.device_code })
      ).json()) as { refresh_token: string };

      world.activeMembership = false;

      const refreshed = await api.post("/api/auth/cli/refresh", {
        refresh_token: exchanged.refresh_token,
      });

      expect(refreshed.status).toBe(401);
      await expect(refreshed.json()).resolves.toMatchObject({ error: "invalid_grant" });

      // The presented refresh token is revoked: a retry with the same token is
      // refused again rather than answering from a still-live record.
      const retried = await api.post("/api/auth/cli/refresh", {
        refresh_token: exchanged.refresh_token,
      });

      expect(retried.status).toBe(401);
    });
  });

  describe("when the organization caps sessions and the CLI logs in then refreshes", () => {
    let world: ReturnType<typeof deviceFlowWorld>;
    let api: ReturnType<typeof mount>;
    let grant: z.infer<typeof deviceGrantSchema>;

    beforeEach(async () => {
      world = deviceFlowWorld();
      world.maxSessionDurationDays = 30;
      api = mount(world);
      grant = deviceGrantSchema.parse(
        await (await api.post("/api/auth/cli/device-code", {})).json(),
      );
      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });
    });

    /** @scenario "the CLI key is minted with the session's expiry" */
    it("mints the key anchored at the session start, under the ceiling and the refresh window", async () => {
      const before = Date.now();

      const exchanged = await api.post("/api/auth/cli/exchange", {
        device_code: grant.device_code,
        client_info: { hostname: "Bobs-MacBook-Pro" },
      });

      expect(exchanged.status).toBe(200);
      const [minted] = world.mintedExpiries;
      expect(minted?.sessionStartedAtMs).toBeGreaterThanOrEqual(before);
      expect(minted?.sessionStartedAtMs).toBeLessThanOrEqual(Date.now());
      expect(minted).toMatchObject({
        maxSessionDurationDays: 30,
        refreshWindowMs: REFRESH_WINDOW_MS,
      });
    });

    /** @scenario "refreshing the session extends the CLI key's expiry" */
    it("extends the key's expiry from the same session start on every refresh", async () => {
      const exchanged = z.object({ refresh_token: z.string() }).parse(
        await (
          await api.post("/api/auth/cli/exchange", {
            device_code: grant.device_code,
            client_info: { hostname: "Bobs-MacBook-Pro" },
          })
        ).json(),
      );

      const refreshed = await api.post("/api/auth/cli/refresh", {
        refresh_token: exchanged.refresh_token,
      });

      expect(refreshed.status).toBe(200);
      expect(world.extendedExpiries).toEqual([
        {
          apiKeyId: "apikey-1",
          sessionStartedAtMs: world.mintedExpiries[0]?.sessionStartedAtMs,
          maxSessionDurationDays: 30,
          refreshWindowMs: REFRESH_WINDOW_MS,
        },
      ]);
    });
  });

  describe("when the CLI calls the logout endpoint", () => {
    /** @scenario "logout revokes the CLI key" */
    it("revokes the CLI key along with the device session tokens", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        device_code: string;
        user_code: string;
      };

      await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
      });

      const exchanged = (await (
        await api.post("/api/auth/cli/exchange", { device_code: grant.device_code })
      ).json()) as { access_token: string; refresh_token: string };

      const loggedOut = await api.post("/api/auth/cli/logout", {
        access_token: exchanged.access_token,
        refresh_token: exchanged.refresh_token,
      });

      expect(loggedOut.status).toBe(200);
      expect(world.revokedForLogout).toEqual([{ apiKeyId: "apikey-1", userId: USER_ID }]);
    });

    it("stays a 200 for a body it could not read, since there is nothing to revoke", async () => {
      const world = deviceFlowWorld();
      const api = mount(world);

      const loggedOut = await api.post("/api/auth/cli/logout", { refresh_token: 7 });

      expect(loggedOut.status).toBe(200);
      await expect(loggedOut.json()).resolves.toEqual({ ok: true });
    });
  });

  describe("when the browser half is reached with no session", () => {
    it("refuses the lookup, the approval and the denial alike", async () => {
      const world = deviceFlowWorld({ signedIn: false });
      const api = mount(world);

      const statuses = await Promise.all([
        api.get("/api/auth/cli/lookup?user_code=ABCD-1234").then((r) => r.status),
        api.post("/api/auth/cli/approve", { user_code: "ABCD-1234", organization_id: "org-1" }),
        api.post("/api/auth/cli/deny", { user_code: "ABCD-1234" }),
      ]);

      expect(
        statuses.map((answer) => (typeof answer === "number" ? answer : answer.status)),
      ).toEqual([401, 401, 401]);
    });
  });

  describe("when the deployment names no public origin", () => {
    it("still round-trips the CLI through the fallback the client uses", async () => {
      const world = deviceFlowWorld({ publicBaseUrl: undefined });
      const api = mount(world);

      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        verification_uri: string;
      };

      expect(grant.verification_uri).toBe("http://localhost:5560/cli/auth");
    });
  });
});

// --------------------------------------------------------------------------

/** The grant's substrate, in memory, with no expiry sweeping of its own. */
class InMemoryDeviceSessionStore implements CliDeviceSessionRepository {
  private readonly values = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  dump(): string[] {
    return [...this.values.values()];
  }

  get(key: string): Promise<string> {
    const value = this.values.get(key);

    return value === undefined
      ? Promise.reject(new CliSessionRecordNotFoundError())
      : Promise.resolve(value);
  }

  set(input: { key: string; value: string }): Promise<void> {
    this.values.set(input.key, input.value);

    return Promise.resolve();
  }

  setIfAbsent(input: { key: string; value: string }): Promise<boolean> {
    if (this.values.has(input.key)) return Promise.resolve(false);

    this.values.set(input.key, input.value);

    return Promise.resolve(true);
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    this.sets.delete(key);

    return Promise.resolve();
  }

  /**
   * The keys currently held. Redemption-claim tests assert on the presence of
   * the claim itself — whether it survives a successful exchange is the whole
   * point. No expiry here: a test that wants a key gone deletes it.
   */
  keys(): string[] {
    return [...this.values.keys()];
  }

  indexTokens(input: { indexKey: string; memberKeys: string[] }): Promise<void> {
    const members = this.sets.get(input.indexKey) ?? new Set<string>();

    for (const member of input.memberKeys) members.add(member);

    this.sets.set(input.indexKey, members);

    return Promise.resolve();
  }

  removeFromIndex(input: { indexKey: string; memberKey: string }): Promise<void> {
    this.sets.get(input.indexKey)?.delete(input.memberKey);

    return Promise.resolve();
  }

  findIndexedTokens(indexKey: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(indexKey) ?? [])]);
  }

  deleteIndexedTokens(input: { indexKey: string; memberKeys: readonly string[] }): Promise<number> {
    const deleted = input.memberKeys.filter((key) => this.values.delete(key)).length;
    input.memberKeys.forEach((key) => this.sets.get(input.indexKey)?.delete(key));

    return Promise.resolve(deleted);
  }
}

/** The project a `project_api_key` grant points at, as the directory answers it now. */
type LiveProject = {
  id: string;
  slug: string;
  name: string;
  teamId: string;
  apiKey: string;
  isPersonal: boolean;
  ownerUserId: string | null;
};

function liveProject(overrides: Partial<LiveProject> = {}): LiveProject {
  return {
    id: "project-shared",
    slug: "shared",
    name: "Shared",
    teamId: "team-shared",
    apiKey: "sk-lw-shared",
    isPersonal: false,
    ownerUserId: null,
    ...overrides,
  };
}

/** What a CLI login key's expiry is computed from. */
type KeyExpiryInput = {
  sessionStartedAtMs?: number | undefined;
  maxSessionDurationDays?: number | undefined;
  refreshWindowMs?: number | undefined;
};

function deviceFlowWorld(
  overrides: {
    mintToken?: string;
    mintError?: () => Error;
    validateSelectionError?: () => Error;
    /** The management permissions the approver holds; all of them when unset. */
    heldManagement?: string[];
    /** The key an approval that names no selection gets. */
    defaultSelection?: {
      bindings: { scopeType: string; scopeId: string }[];
      permissions: string[];
    };
    signedIn?: boolean;
    /** What the governance flag answers; enabled when unset. */
    governanceFlag?: () => Promise<boolean>;
    publicBaseUrl?: string | undefined;
  } = {},
) {
  const store = new InMemoryDeviceSessionStore();
  /** What the world answers right now — every field a test may move mid-flow. */
  interface DeviceFlowWorld {
    activeMembership: boolean;
    /** The project the directory answers NOW, moved between approve and exchange. */
    project: LiveProject | null;
    /** Whether the person still administers it NOW. */
    administersProject: boolean;
    /** Whether the identity read answers at all, for the release-on-failure path. */
    personExists: boolean;
    /** Whether the session-ceiling read fails unexpectedly, mid-rotation. */
    directoryFails: boolean;
    store: InMemoryDeviceSessionStore;
    mintedKeys: { deviceLabel: string; userId: string }[];
    revokedForLogout: { apiKeyId: string; userId: string }[];
    /** The organization's session ceiling in days; 0 sets none. */
    maxSessionDurationDays: number;
    mintedExpiries: KeyExpiryInput[];
    extendedExpiries: (KeyExpiryInput & { apiKeyId: string })[];
    /** Every key selection validated, in order, the approval's own last. */
    validatedSelections: { permissions: string[] }[];
  }
  const world: DeviceFlowWorld = {
    activeMembership: true,
    project: null,
    administersProject: true,
    personExists: true,
    directoryFails: false,
    store,
    mintedKeys: [],
    revokedForLogout: [],
    maxSessionDurationDays: 0,
    mintedExpiries: [],
    extendedExpiries: [],
    validatedSelections: [],
  };

  const directory: AuthDirectory = {
    getOrganizationIdBySsoDomain: () => Promise.reject(new OrganizationNotFoundError()),
    getPerson: (userId) =>
      world.personExists
        ? Promise.resolve({ id: USER_ID, name: "Bob", email: "bob@example.test" })
        : Promise.reject(new UserNotFoundError(userId)),
    getOrganization: () => Promise.resolve({ id: ORGANIZATION_ID, name: "Acme", slug: "acme" }),
    maxSessionDurationDays: () =>
      world.directoryFails
        ? Promise.reject(new Error("directory unavailable"))
        : Promise.resolve(world.maxSessionDurationDays),
    hasActiveMembership: () => Promise.resolve(world.activeMembership),
    getLiveProject: () =>
      world.project === null
        ? Promise.reject(new ProjectNotFoundError())
        : Promise.resolve(world.project),
    getLiveProjectByRef: () =>
      world.project === null
        ? Promise.reject(new ProjectNotFoundError())
        : Promise.resolve(world.project),
  };

  const sessions = CliDeviceSessionService.create({
    store,
    settlements: MemoryCliDeviceSettlementChannel.create(),
  });

  const collaborators: CliDeviceFlowCollaborators = {
    sessions: () => sessions,
    directory: () => directory,
    session: () =>
      Promise.resolve(
        overrides.signedIn === false
          ? null
          : { id: USER_ID, name: "Bob", email: "bob@example.test" },
      ),
    apiKeys: () =>
      ({
        mintCliLoginKey: (input: { userId: string; deviceLabel: string } & KeyExpiryInput) => {
          if (overrides.mintError) return Promise.reject(overrides.mintError());

          world.mintedKeys.push({ deviceLabel: input.deviceLabel, userId: input.userId });
          world.mintedExpiries.push({
            sessionStartedAtMs: input.sessionStartedAtMs,
            maxSessionDurationDays: input.maxSessionDurationDays,
            refreshWindowMs: input.refreshWindowMs,
          });

          return Promise.resolve({
            token: overrides.mintToken ?? "lw_cli_minted",
            apiKeyId: "apikey-1",
            scope: { kind: "organization" as const, projectIds: [], permissions: [] },
          });
        },
        validateCliSelection: (input: { selection: { permissions: string[] } }) => {
          if (overrides.validateSelectionError) {
            return Promise.reject(overrides.validateSelectionError());
          }
          const beyondCeiling = input.selection.permissions.find(
            (permission) =>
              MANAGEMENT_PERMISSIONS.includes(permission) &&
              overrides.heldManagement !== undefined &&
              !overrides.heldManagement.includes(permission),
          );
          if (beyondCeiling) {
            return Promise.reject(
              new ApiKeyScopeViolationError(`${beyondCeiling} exceeds ceiling`),
            );
          }
          world.validatedSelections.push(input.selection);

          return Promise.resolve(input.selection);
        },
        findDefaultCliSelection: () =>
          Promise.resolve(overrides.defaultSelection ?? { bindings: [], permissions: [] }),
        extendCliLoginKeyExpiry: (input: KeyExpiryInput & { apiKeyId: string }) => {
          world.extendedExpiries.push({
            apiKeyId: input.apiKeyId,
            sessionStartedAtMs: input.sessionStartedAtMs,
            maxSessionDurationDays: input.maxSessionDurationDays,
            refreshWindowMs: input.refreshWindowMs,
          });

          return Promise.resolve();
        },
        revokeCliLoginKeyForLogout: (input: { apiKeyId: string; userId: string }) => {
          world.revokedForLogout.push({ apiKeyId: input.apiKeyId, userId: input.userId });

          return Promise.resolve();
        },
      }) as never,
    ensurePersonalWorkspace: () =>
      Promise.resolve({
        team: { id: "team-personal" },
        project: {
          id: "project-personal",
          slug: "personal-bob",
          name: "Bob",
        },
      }),
    canViewProject: () => Promise.resolve(world.administersProject),
    featureFlags: () =>
      ({ isEnabled: overrides.governanceFlag ?? (() => Promise.resolve(true)) }) as never,
    publicBaseUrl: () =>
      "publicBaseUrl" in overrides ? overrides.publicBaseUrl : "https://app.test",
  };
  const flow = CliDeviceFlowService.create({ collaborators });
  const door: AuthCliDeviceFlowApi = {
    startCliDeviceCode: (input) => flow.startDeviceCode(input),
    exchangeCliDeviceCode: (input) => flow.exchangeDeviceCode(input),
    refreshCliDeviceSession: (input) => flow.refreshSession(input),
    lookupCliDeviceCode: (input) => flow.lookupDeviceCode(input),
    approveCliDeviceCode: (input) => flow.approveDeviceCode(input),
    denyCliDeviceCode: (input) => flow.denyDeviceCode(input),
    endCliDeviceSession: (input) => flow.endSession(input),
    watchCliDeviceApproval: (input) => flow.watchDeviceApproval(input),
  };

  return Object.assign(world, { door, flow, sessions });
}

/** A person's own CLI session, bound to no project, as a plain `langwatch login` holds one. */
async function personSession(world: ReturnType<typeof deviceFlowWorld>) {
  const api = mount(world);
  const grant = deviceGrantSchema.parse(
    await (await api.post("/api/auth/cli/device-code", {})).json(),
  );
  await api.post("/api/auth/cli/approve", {
    user_code: grant.user_code,
    organization_id: ORGANIZATION_ID,
  });
  const exchanged = (await (
    await api.post("/api/auth/cli/exchange", { device_code: grant.device_code })
  ).json()) as { access_token: string; refresh_token: string };

  return { api, accessToken: exchanged.access_token, refreshToken: exchanged.refresh_token };
}

function mount(world: ReturnType<typeof deviceFlowWorld>) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the device grant resolves its own credential.");
      },
    },
  });
  const hono = runtime.mount(authCliDeviceFlowRest.router(), {
    app: () => world.door,
    credential: "public",
    // The refusal the family's own boundary renders, reduced to the two fields
    // this suite reads: a handled error keeps its code, anything else is a 500.
    onError: (error, context) => {
      const refusal = refusalOf(error);

      return refusal
        ? context.json({ error: refusal.code }, refusal.status)
        : context.json({ error: "server_error" }, 500);
    },
  });
  const fetchAt = async (path: string, init?: RequestInit): Promise<Response> =>
    hono.fetch(new Request(`http://api.test${path}`, init));

  return {
    get: (path: string) => fetchAt(path),
    post: (path: string, body: unknown) =>
      fetchAt(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}

/** A refusal the application named, as the process's own boundary reads one. */
function refusalOf(error: unknown): { code: string; status: 400 | 403 | 500 } | null {
  if (typeof error !== "object" || error === null) return null;

  const code = Reflect.get(error, "code");
  const status = Reflect.get(error, "httpStatus");

  if (typeof code !== "string") return null;

  return { code, status: status === 400 || status === 403 ? status : 500 };
}

describe("given a refusal on the device flow", () => {
  const exactly = async (response: Response) => ({
    status: response.status,
    body: await response.text(),
  });
  const rfc = (status: number, error: string, description: string) => ({
    status,
    body: JSON.stringify({ error, error_description: description }),
  });

  describe("when the CLI polls with a device code nobody minted", () => {
    /** @scenario "An unknown device code polled at exchange answers expired_token" */
    it("answers 408 expired_token in the body released CLIs parse", async () => {
      const api = mount(deviceFlowWorld());

      const polled = await api.post("/api/auth/cli/exchange", { device_code: "never-minted" });

      expect(await exactly(polled)).toEqual(
        rfc(408, "expired_token", "Device code expired or unknown"),
      );
    });
  });

  describe("when the approval page looks up a user code nobody minted", () => {
    /** @scenario "The approval page's lookup of an unknown code says it may have expired" */
    it("answers 404 not_found with the expiry hint", async () => {
      const api = mount(deviceFlowWorld());

      const looked = await api.get("/api/auth/cli/lookup?user_code=ABCD-1234");

      expect(await exactly(looked)).toEqual(
        rfc(404, "not_found", "Code not recognised — it may have expired"),
      );
    });
  });

  describe("when a member approves a user code nobody minted", () => {
    /** @scenario "Approving an unknown code answers not_found" */
    it("answers 404 not_found without the expiry hint", async () => {
      const api = mount(deviceFlowWorld());

      const approved = await api.post("/api/auth/cli/approve", {
        user_code: "ABCD-1234",
        organization_id: ORGANIZATION_ID,
      });

      expect(await exactly(approved)).toEqual(rfc(404, "not_found", "Code not recognised"));
    });
  });

  describe("when a person denies a user code nobody minted", () => {
    /** @scenario "Denying an unknown code is a no-op" */
    it("answers ok, as denying an unknown code always has", async () => {
      const api = mount(deviceFlowWorld());

      const denied = await api.post("/api/auth/cli/deny", { user_code: "ABCD-1234" });

      expect(await exactly(denied)).toEqual({ status: 200, body: JSON.stringify({ ok: true }) });
    });
  });

  describe("when the browser half is reached with no session", () => {
    /** @scenario "The browser half refuses a caller with no session in the RFC 8628 shape" */
    it("answers each route 401 unauthorized in the RFC 8628 shape", async () => {
      const api = mount(deviceFlowWorld({ signedIn: false }));

      const answers = await Promise.all([
        api.get("/api/auth/cli/lookup?user_code=ABCD-1234").then(exactly),
        api
          .post("/api/auth/cli/approve", { user_code: "ABCD-1234", organization_id: "org-1" })
          .then(exactly),
        api.post("/api/auth/cli/deny", { user_code: "ABCD-1234" }).then(exactly),
      ]);

      expect(answers).toEqual(
        Array.from({ length: 3 }, () => rfc(401, "unauthorized", "Sign in to continue")),
      );
    });
  });

  describe("when the CLI rotates a refresh token nobody minted", () => {
    /** @scenario "An unknown refresh token answers invalid_grant" */
    it("answers 401 invalid_grant, on which the CLI wipes local state", async () => {
      const api = mount(deviceFlowWorld());

      const rotated = await api.post("/api/auth/cli/refresh", { refresh_token: "lw_rt_unknown" });

      expect(await exactly(rotated)).toEqual(
        rfc(401, "invalid_grant", "Refresh token is invalid or revoked"),
      );
    });
  });

  describe("when a collaborator fails in a way the flow does not name", () => {
    /** @scenario "A failure the flow did not name still answers in the RFC 8628 shape" */
    it("answers 500 server_error and says nothing about the cause", async () => {
      const world = deviceFlowWorld({
        validateSelectionError: () => new Error("registry connection reset"),
      });
      const api = mount(world);
      const grant = (await (await api.post("/api/auth/cli/device-code", {})).json()) as {
        user_code: string;
      };

      const approved = await api.post("/api/auth/cli/approve", {
        user_code: grant.user_code,
        organization_id: ORGANIZATION_ID,
        key_selection: {
          bindings: [{ scope_type: "ORGANIZATION", scope_id: ORGANIZATION_ID }],
          permissions: ["traces:view"],
        },
      });

      expect(await exactly(approved)).toEqual(
        rfc(500, "server_error", "The request could not be completed"),
      );
    });
  });
});
