/**
 * @vitest-environment node
 *
 * Integration coverage for the no-paste convergence — `credential_type`
 * discriminator that lets `langwatch login` mint either:
 *
 *   - a device session (existing behavior, default for back-compat) → returns
 *     access+refresh tokens + personal VK; CLI persists to ~/.langwatch/config.json
 *   - a project API key (new) → returns the user-picked project's existing
 *     apiKey verbatim; CLI persists `LANGWATCH_API_KEY=...` to $CWD/.env
 *
 * Exercises `/device-code` → `approveDeviceCode` (in-process) → `/exchange`
 * round-trip with real Redis + real Prisma. The browser-mediated `/approve`
 * route requires NextAuth session (separately covered by the /cli/auth page
 * dogfood); we exercise the underlying `approveDeviceCode` helper directly so
 * the discriminator's response-shape contract is pinned end-to-end.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { app, approveDeviceCode } from "../auth-cli";

const suffix = nanoid(8);
const ORG_ID = `org-credtype-${suffix}`;
const TEAM_ID = `team-credtype-${suffix}`;
const USER_ID = `usr-credtype-${suffix}`;
const PROJECT_ID = `proj-credtype-${suffix}`;
const PROJECT_API_KEY = `sk-lw-credtype-${suffix}-${"a".repeat(36)}`;

async function callDeviceCode(body: Record<string, unknown>) {
  return await app.request("/api/auth/cli/device-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callExchange(deviceCode: string) {
  return await app.request("/api/auth/cli/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
  });
}

describe("CLI credential_type discriminator — no-paste convergence", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `CredType Org ${suffix}`, slug: `credtype-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `CredType Team ${suffix}`,
        slug: `credtype-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `credtype-${suffix}@example.com`,
        name: `CredType ${suffix}`,
      },
    });
    await prisma.organizationUser.create({
      data: { userId: USER_ID, organizationId: ORG_ID, role: "ADMIN" },
    });
    await prisma.teamUser.create({
      data: { userId: USER_ID, teamId: TEAM_ID, role: "ADMIN" },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `CredType Project ${suffix}`,
        slug: `credtype-proj-${suffix}`,
        apiKey: PROJECT_API_KEY,
        teamId: TEAM_ID,
        language: "typescript",
        framework: "openai",
      },
    });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } }).catch(() => {});
    await prisma.teamUser
      .deleteMany({ where: { userId: USER_ID, teamId: TEAM_ID } })
      .catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { userId: USER_ID, organizationId: ORG_ID } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: USER_ID } }).catch(() => {});
    await prisma.team.deleteMany({ where: { id: TEAM_ID } }).catch(() => {});
    await prisma.organization
      .deleteMany({ where: { id: ORG_ID } })
      .catch(() => {});
    await stopTestContainers().catch(() => {});
  });

  describe("when CLI requests credential_type=project_api_key", () => {
    it("server returns the project's existing apiKey verbatim with kind:'api_key' on /exchange", async () => {
      // CLI: POST /device-code with credential_type=project_api_key
      const dcRes = await callDeviceCode({
        credential_type: "project_api_key",
      });
      expect(dcRes.status).toBe(200);
      const dc = (await dcRes.json()) as {
        device_code: string;
        user_code: string;
      };
      expect(dc.device_code).toBeTruthy();
      expect(dc.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

      // Browser-side approval (simulated): the /cli/auth page UI normally
      // calls POST /approve which requires a NextAuth session; here we drive
      // the underlying helper directly with the project payload the route
      // would have produced after access-checking the picked project.
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: PROJECT_ID },
        select: { id: true, slug: true, name: true, apiKey: true },
      });
      const approval = await approveDeviceCode({
        deviceCode: dc.device_code,
        userId: USER_ID,
        organizationId: ORG_ID,
        projectApiKey: {
          project_id: project.id,
          project_slug: project.slug,
          project_name: project.name,
          api_key: project.apiKey,
        },
      });
      expect(approval.approved).toBe(true);

      // CLI polls /exchange — discriminator path returns kind:'api_key'
      const exRes = await callExchange(dc.device_code);
      expect(exRes.status).toBe(200);
      const ex = (await exRes.json()) as Record<string, unknown>;

      expect(ex.kind).toBe("api_key");
      expect(ex.api_key).toBe(PROJECT_API_KEY);
      expect(ex.project).toEqual({
        id: PROJECT_ID,
        slug: `credtype-proj-${suffix}`,
        name: `CredType Project ${suffix}`,
      });
      // No access_token / refresh_token in api_key mode — the apiKey IS the
      // credential the SDK uses; sessions are not needed.
      expect(ex.access_token).toBeUndefined();
      expect(ex.refresh_token).toBeUndefined();
      // Endpoint is shipped so self-hosted dashboards' install-card-driven
      // flow can prefill `LANGWATCH_ENDPOINT` alongside the apiKey.
      expect(ex.endpoint).toEqual(expect.stringMatching(/^https?:\/\//));
    });
  });

  describe("when CLI requests credential_type=device_session (default)", () => {
    it("response shape stays back-compat with the addition of kind:'device_session'", async () => {
      // Older CLIs that don't send credential_type get device_session by
      // default — they keep working unchanged.
      const dcRes = await callDeviceCode({});
      expect(dcRes.status).toBe(200);
      const dc = (await dcRes.json()) as { device_code: string };

      const approval = await approveDeviceCode({
        deviceCode: dc.device_code,
        userId: USER_ID,
        organizationId: ORG_ID,
        personalVk: {
          id: `vk-credtype-${suffix}`,
          label: "default",
          secret: `sk-vk-credtype-${suffix}-${"a".repeat(40)}`,
          base_url: "https://gateway.langwatch.ai",
        },
      });
      expect(approval.approved).toBe(true);

      const exRes = await callExchange(dc.device_code);
      expect(exRes.status).toBe(200);
      const ex = (await exRes.json()) as Record<string, unknown>;

      expect(ex.kind).toBe("device_session");
      expect(ex.access_token).toEqual(expect.stringMatching(/^lw_at_/));
      expect(ex.refresh_token).toEqual(expect.stringMatching(/^lw_rt_/));
      expect(ex.default_personal_vk).toBeDefined();
      // No api_key field in device_session mode.
      expect(ex.api_key).toBeUndefined();
      expect(ex.endpoint).toEqual(expect.stringMatching(/^https?:\/\//));
    });
  });
});
