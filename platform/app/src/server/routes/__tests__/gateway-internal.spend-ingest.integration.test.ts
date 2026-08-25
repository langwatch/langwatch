/**
 * @vitest-environment node
 *
 * Attribution enrichment at the spend-command ingest seam, against real
 * Postgres and the real signed internal route.
 *
 * The gateway knows the key and the project; the team and the key's
 * principal live on control-plane rows it never reads. This suite pins the
 * join the ingest seam does on its behalf, and the two ways it can come up
 * short: a MISSING row degrades one record and says so, an unreadable
 * database fails the whole batch so the drainer comes back.
 *
 * Spec: specs/ai-gateway/_shared/contract.md §4.5
 */

import { createHash, createHmac } from "crypto";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { globalForApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { app } from "../gateway-internal";

const suffix = nanoid(8);
const ORG_ID = `org-ingest-${suffix}`;
const OTHER_ORG_ID = `org-ingest-other-${suffix}`;
const TEAM_ID = `team-ingest-${suffix}`;
const OTHER_TEAM_ID = `team-ingest-other-${suffix}`;
const PROJECT_ID = `proj-ingest-${suffix}`;
const USER_ID = `usr-ingest-${suffix}`;
const VK_ID = `vk-ingest-${suffix}`;
const FOREIGN_VK_ID = `vk-ingest-foreign-${suffix}`;
// Sequential-hex HMAC fixture for the signed-route test, not a credential;
// allowlisted by path in .gitleaks.toml.
const SECRET = "0123456789abcdef0123456789abcdef";

/** Every admission the route appended, in order, as the pipeline saw it. */
let appended: Array<Record<string, unknown>> = [];
/** Every confirmation the route appended, which the seam now enriches too. */
let appendedConfirms: Array<Record<string, unknown>> = [];

function signedPost(path: string, payload: unknown) {
  const fullPath = `/api/internal/gateway${path}`;
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `POST\n${fullPath}\n${timestamp}\n${bodyHash}`;
  const signature = createHmac("sha256", SECRET).update(canonical).digest("hex");
  return new Request(`http://localhost${fullPath}`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
    },
  });
}

/** One wire admit record, with only the fields the gateway actually sends. */
function admitRecord(overrides: Record<string, unknown> = {}) {
  return {
    command: "admitSpend" as const,
    pod_id: "pod-a",
    pod_seq: 1,
    payload: {
      gateway_request_id: `req-${nanoid(10)}`,
      occurred_at: Date.now(),
      organization_id: ORG_ID,
      project_id: PROJECT_ID,
      virtual_key_id: VK_ID,
      model: "gpt-x",
      ...overrides,
    },
  };
}

async function postRecords(records: unknown[]) {
  const response = await app.fetch(signedPost("/spend-commands", { records }));
  return { status: response.status, body: await response.json() };
}

async function lastUsedAt(id = VK_ID): Promise<Date | null> {
  const vk = await prisma.virtualKey.findUnique({
    where: { id },
    select: { lastUsedAt: true },
  });
  return vk?.lastUsedAt ?? null;
}

describe("spend-command ingest enrichment (real PG + internal route)", () => {
  let previousSecret: string | undefined;
  let previousApp: (typeof globalForApp)["__langwatch_app"];

  beforeAll(async () => {
    await startTestContainers();
    previousSecret = process.env.LW_GATEWAY_INTERNAL_SECRET;
    process.env.LW_GATEWAY_INTERNAL_SECRET = SECRET;

    // The route only needs the spend pipeline's command surface; standing up
    // the whole event-sourcing runtime would test the framework, not the seam.
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = {
      eventSourcing: {
        getPipeline: () => ({
          commands: {
            admitSpend: {
              sendBatch: (payloads: Array<Record<string, unknown>>) => {
                appended.push(...payloads);
                return Promise.resolve();
              },
              send: (payload: Record<string, unknown>) => {
                appended.push(payload);
                return Promise.resolve();
              },
            },
            confirmSpend: {
              sendBatch: (payloads: Array<Record<string, unknown>>) => {
                appendedConfirms.push(...payloads);
                return Promise.resolve();
              },
              send: (payload: Record<string, unknown>) => {
                appendedConfirms.push(payload);
                return Promise.resolve();
              },
            },
            failSpend: { send: () => Promise.resolve() },
          },
        }),
      },
    } as never;

    for (const tenant of [
      { orgId: ORG_ID, teamId: TEAM_ID },
      { orgId: OTHER_ORG_ID, teamId: OTHER_TEAM_ID },
    ]) {
      await prisma.organization.create({
        data: {
          id: tenant.orgId,
          name: `Ingest ${tenant.orgId}`,
          slug: tenant.orgId,
        },
      });
      await prisma.team.create({
        data: {
          id: tenant.teamId,
          name: `Ingest ${tenant.teamId}`,
          slug: tenant.teamId,
          organizationId: tenant.orgId,
        },
      });
    }
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Ingest Project ${suffix}`,
        slug: `ingest-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `ingest-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@ingest.local`, name: "Seat" },
    });
    await prisma.virtualKey.createMany({
      data: [
        {
          id: VK_ID,
          organizationId: ORG_ID,
          name: `ingest-${suffix}`,
          hashedSecret: `hash-${suffix}`,
          displayPrefix: `vk-lw-${suffix}`,
          createdById: USER_ID,
          principalUserId: USER_ID,
        },
        {
          id: FOREIGN_VK_ID,
          organizationId: OTHER_ORG_ID,
          name: `ingest-foreign-${suffix}`,
          hashedSecret: `hash-foreign-${suffix}`,
          displayPrefix: `vk-lw-f${suffix}`,
          createdById: USER_ID,
        },
      ],
    });
  }, 120_000);

  afterEach(() => {
    appended = [];
    appendedConfirms = [];
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    globalForApp.__langwatch_app = previousApp;
    if (previousSecret === undefined) {
      delete process.env.LW_GATEWAY_INTERNAL_SECRET;
    } else {
      process.env.LW_GATEWAY_INTERNAL_SECRET = previousSecret;
    }
    await prisma.virtualKey.deleteMany({
      where: { organizationId: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({
      where: { id: { in: [TEAM_ID, OTHER_TEAM_ID] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await stopTestContainers();
  });

  /** @scenario An admitted request carries the team and principal it debits */
  it("joins the team and the principal onto every admission", async () => {
    await prisma.virtualKey.update({
      where: { id: VK_ID },
      data: { lastUsedAt: null },
    });

    const { status, body } = await postRecords([admitRecord(), admitRecord()]);

    expect(status).toBe(200);
    expect(body).toMatchObject({ accepted: 2, rejected: [] });
    expect(appended).toHaveLength(2);
    for (const admitted of appended) {
      expect(admitted).toMatchObject({
        tenantId: PROJECT_ID,
        virtual_key_id: VK_ID,
        team_id: TEAM_ID,
        principal_user_id: USER_ID,
      });
    }
    // The key was in use, so admission is what advances the column: one write
    // for the whole batch, not one per record.
    expect(await lastUsedAt()).not.toBeNull();
  });

  /** @scenario Ingest joins the control-plane attribution onto outcomes too */
  it("joins the team and the principal onto attributed confirmations", async () => {
    const { status } = await postRecords([
      {
        command: "confirmSpend" as const,
        pod_id: "pod-a",
        pod_seq: 1,
        payload: {
          gateway_request_id: `req-${nanoid(10)}`,
          occurred_at: Date.now(),
          project_id: PROJECT_ID,
          usage: {},
          // The attribution a build that repeats it on the outcome sends.
          organization_id: ORG_ID,
          virtual_key_id: VK_ID,
        },
      },
    ]);

    expect(status).toBe(200);
    expect(appendedConfirms).toHaveLength(1);
    expect(appendedConfirms[0]).toMatchObject({
      tenantId: PROJECT_ID,
      virtual_key_id: VK_ID,
      team_id: TEAM_ID,
      principal_user_id: USER_ID,
    });
  });

  /** @scenario An outcome from a build that carries no attribution is left alone */
  it("skips enrichment for a confirmation that names no key", async () => {
    const { status } = await postRecords([
      {
        command: "confirmSpend" as const,
        pod_id: "pod-a",
        pod_seq: 1,
        payload: {
          gateway_request_id: `req-${nanoid(10)}`,
          occurred_at: Date.now(),
          project_id: PROJECT_ID,
          usage: {},
        },
      },
    ]);

    expect(status).toBe(200);
    expect(appendedConfirms).toHaveLength(1);
    // Nothing to join against, so the seam does not touch the record at all
    // — these stay ABSENT rather than being stamped empty, and the command
    // schema's own defaults fill them when the pipeline parses it. Those
    // requests keep the admission-time join in the consuming process
    // managers, which is what their admission's
    // `outcome_carries_attribution` flag asks for.
    expect(appendedConfirms[0]).not.toHaveProperty("principal_user_id");
    expect(appendedConfirms[0]).not.toHaveProperty("team_id");
  });

  /** @scenario A key in constant use is not written on every request */
  it("advances lastUsedAt once and then leaves it alone", async () => {
    await prisma.virtualKey.update({
      where: { id: VK_ID },
      data: { lastUsedAt: null },
    });

    await postRecords([admitRecord()]);
    const firstTouch = await lastUsedAt();
    expect(firstTouch).not.toBeNull();

    await postRecords([admitRecord()]);
    expect((await lastUsedAt())?.getTime()).toBe(firstTouch?.getTime());
  });

  it("advances lastUsedAt for a key whose request the gateway went on to block", async () => {
    // A blocked request is admitted first, so oversight still sees the key.
    await prisma.virtualKey.update({
      where: { id: VK_ID },
      data: { lastUsedAt: new Date(Date.now() - 10 * 60_000) },
    });

    await postRecords([admitRecord()]);

    const touched = await lastUsedAt();
    expect(Date.now() - (touched?.getTime() ?? 0)).toBeLessThan(60_000);
  });

  /** @scenario A deleted key or a teamless project degrades one record, not the batch */
  it("degrades attribution for rows that no longer exist and still appends", async () => {
    const { status, body } = await postRecords([
      admitRecord({ virtual_key_id: `vk-gone-${suffix}` }),
      admitRecord({ project_id: `proj-gone-${suffix}` }),
      admitRecord(),
    ]);

    expect(status).toBe(200);
    expect(body).toMatchObject({ accepted: 3, rejected: [] });
    expect(appended).toHaveLength(3);
    // A key that no longer exists costs the principal and group budgets, not
    // the project's own debits.
    expect(appended[0]).toMatchObject({
      team_id: TEAM_ID,
      principal_user_id: "",
    });
    // A project the control plane cannot resolve costs the team budgets.
    expect(appended[1]).toMatchObject({
      team_id: "",
      principal_user_id: USER_ID,
    });
    expect(appended[2]).toMatchObject({
      team_id: TEAM_ID,
      principal_user_id: USER_ID,
    });
  });

  it("appends an admission whose key belongs to another organization", async () => {
    // The record is already durable on the gateway's side and its outcome is
    // still coming, so a cross-tenant mismatch is logged and chased, never
    // turned into lost billing evidence.
    const { status, body } = await postRecords([
      admitRecord({ virtual_key_id: FOREIGN_VK_ID }),
    ]);

    expect(status).toBe(200);
    expect(body).toMatchObject({ accepted: 1, rejected: [] });
    expect(appended).toHaveLength(1);
  });

  /** @scenario An unreadable control plane retries the batch instead of guessing */
  it("fails the whole batch when the database cannot be read", async () => {
    vi.spyOn(prisma.virtualKey, "findMany").mockRejectedValue(
      new Error("connection terminated"),
    );

    const { status } = await postRecords([admitRecord()]);

    // Not a degrade: an event is immutable once appended, so an unknown
    // attribution is a reason to retry the batch, never to guess.
    expect(status).toBe(500);
    expect(appended).toHaveLength(0);
  });

  it("still reports malformed records by index without losing the rest", async () => {
    const { status, body } = await postRecords([
      admitRecord(),
      { ...admitRecord(), payload: { gateway_request_id: "no-project" } },
      admitRecord(),
    ]);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      accepted: 2,
      rejected: [{ index: 1, code: "missing_project_id" }],
    });
    expect(appended).toHaveLength(2);
  });
});
