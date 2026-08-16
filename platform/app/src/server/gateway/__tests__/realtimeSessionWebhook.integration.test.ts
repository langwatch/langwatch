/**
 * The ElevenLabs post-call webhook, end to end over real Postgres.
 *
 * A brokered ElevenLabs conversation reports nothing over its socket, so this
 * route and the reconciler are the only two paths by which a voice call
 * reaches billing. What is asserted here is which deliveries are allowed to
 * close a session, because a session closed wrongly is confirmed spend the
 * fold will never downgrade.
 *
 * Spec: specs/ai-gateway/realtime-sessions.feature
 */
import { createHmac } from "crypto";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

/** Stubbed so a confirmation can be asserted without the whole spend spine. */
const sentConfirmations = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    eventSourcing: {
      getPipeline: () => ({
        commands: {
          confirmSpend: {
            send: (data: Record<string, unknown>) => {
              sentConfirmations.push(data);
              return Promise.resolve();
            },
          },
        },
      }),
    },
  }),
}));

import { app as elevenLabsApp } from "~/server/routes/elevenlabs";
import { encrypt } from "~/utils/encryption";
import { ELEVENLABS_WEBHOOK_SECRET_KEY } from "../elevenLabsCredential.service";
import {
  correlateRealtimeSession,
  reserveRealtimeSession,
} from "../realtimeSession.service";

const suffix = nanoid(8);
const ORG_ID = `org-wh-${suffix}`;
const TEAM_ID = `team-wh-${suffix}`;
const PROJECT_ID = `project-wh-${suffix}`;
const USER_ID = `user-wh-${suffix}`;
const PROVIDER_ID = `mp-wh-${suffix}`;
const WEBHOOK_SECRET = "wsec_integration";

/** An open, correlated session for one conversation id. Returns its id. */
async function openSession(label: string, conversationId: string) {
  const vkId = `vk-${label}-${nanoid(6)}`;
  await prisma.virtualKey.create({
    data: {
      id: vkId,
      organizationId: ORG_ID,
      name: vkId,
      hashedSecret: `hash-${vkId}`,
      displayPrefix: "vk-lw-xxxxxxx",
      createdById: USER_ID,
      traceProjectId: PROJECT_ID,
      config: { realtime: { maxOpenSessions: null } },
      scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
    },
  });
  const sessionId = `sess-${label}-${nanoid(6)}`;
  await reserveRealtimeSession({
    sessionId,
    projectId: PROJECT_ID,
    organizationId: ORG_ID,
    virtualKeyId: vkId,
    modelProviderId: PROVIDER_ID,
    vendor: "elevenlabs",
    model: "convai",
  });
  await correlateRealtimeSession({
    sessionId,
    projectId: PROJECT_ID,
    vendorConversationId: conversationId,
  });
  return sessionId;
}

/** A correctly signed delivery to the webhook route for our provider row. */
async function deliver(payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const mac = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${ts}.${body}`)
    .digest("hex");
  return elevenLabsApp.request(`/api/elevenlabs/webhook/${PROVIDER_ID}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "elevenlabs-signature": `t=${ts},v0=${mac}`,
    },
    body,
  });
}

async function statusOf(sessionId: string): Promise<string | undefined> {
  return (
    await prisma.gatewayRealtimeSession.findUnique({ where: { id: sessionId } })
  )?.status;
}

describe("given an ElevenLabs credential with a stored webhook secret", () => {
  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: { id: ORG_ID, name: `Org ${suffix}`, slug: ORG_ID },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Team ${suffix}`,
        slug: TEAM_ID,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: PROJECT_ID,
        slug: PROJECT_ID,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${PROJECT_ID}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${USER_ID}@acme.test`, name: USER_ID },
    });
    await prisma.modelProvider.create({
      data: {
        id: PROVIDER_ID,
        organizationId: ORG_ID,
        name: "ElevenLabs",
        provider: "elevenlabs",
        enabled: true,
        customKeys: encrypt(
          JSON.stringify({
            ELEVENLABS_API_KEY: "xi-test",
            [ELEVENLABS_WEBHOOK_SECRET_KEY]: WEBHOOK_SECRET,
          }),
        ),
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
  });

  afterAll(async () => {
    await prisma.gatewayRealtimeSession.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.modelProvider.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await stopTestContainers();
  });

  beforeEach(async () => {
    await prisma.gatewayRealtimeSession.deleteMany({
      where: { organizationId: ORG_ID },
    });
    sentConfirmations.length = 0;
  });

  describe("when the delivery is a transcription report carrying a duration", () => {
    /** @scenario A transcription report confirms the session it names */
    it("closes the session and confirms its spend", async () => {
      const sessionId = await openSession("dur", "conv_dur");

      const response = await deliver({
        type: "post_call_transcription",
        data: {
          conversation_id: "conv_dur",
          metadata: {
            call_duration_secs: 3,
            cost: 24,
            cost_fiat: 0.004442603806761652,
          },
        },
      });

      expect(response.status).toBe(200);
      expect(sentConfirmations).toHaveLength(1);
      expect(sentConfirmations[0]?.usage).toMatchObject({ audio_ms: 3000 });
      expect(await statusOf(sessionId)).toBe("CLOSED");
    });
  });

  describe("when the delivery cannot say what the call used", () => {
    /** @scenario A delivery that cannot say what the call used confirms nothing */
    // Every case here names the conversation and would have matched the open
    // session. Confirming any of them writes a zero the fold never
    // downgrades, so the session has to stay open and settle as cost-unknown.
    it.each([
      {
        label: "a post_call_audio event, which carries no metadata",
        conversationId: "conv_audio",
        payload: (id: string) => ({
          type: "post_call_audio",
          data: { conversation_id: id, full_audio: "<base64>" },
        }),
      },
      {
        label: "a call_initiation_failure event",
        conversationId: "conv_init",
        payload: (id: string) => ({
          type: "call_initiation_failure",
          data: { conversation_id: id },
        }),
      },
      {
        label: "a payload with no type at all",
        conversationId: "conv_notype",
        payload: (id: string) => ({
          data: { conversation_id: id, metadata: { call_duration_secs: 3 } },
        }),
      },
      {
        label: "a transcription report with no duration",
        conversationId: "conv_nodur",
        payload: (id: string) => ({
          type: "post_call_transcription",
          data: {
            conversation_id: id,
            metadata: { start_time_unix_secs: 1_780_000_000 },
          },
        }),
      },
      {
        label: "a transcription report whose duration rounds to zero",
        conversationId: "conv_zero",
        payload: (id: string) => ({
          type: "post_call_transcription",
          data: { conversation_id: id, metadata: { call_duration_secs: 0.2 } },
        }),
      },
    ])("acknowledges $label and leaves the session open", async ({
      conversationId,
      payload,
    }) => {
      const sessionId = await openSession("skip", conversationId);

      const response = await deliver(payload(conversationId));

      expect(response.status).toBe(200);
      expect(sentConfirmations).toHaveLength(0);
      expect(await statusOf(sessionId)).toBe("OPEN");
    });
  });
});
