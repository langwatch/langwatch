/**
 * @vitest-environment node
 *
 * Integration coverage for the device-login latency fix: the CLI used to hear
 * about an approval only on its next `/exchange` poll, so a login approved in
 * two seconds still sat on the spinner for the rest of the interval.
 *
 * Two server-side halves are exercised here against real Redis:
 *   - `GET /api/auth/cli/device-approval` emits a frame the moment the browser
 *     settles the code, and emits one right away for a code already settled.
 *   - `POST /api/auth/cli/exchange` skips its per-device poll window once the
 *     code has settled, so the poll the stream just asked for is answered
 *     instead of being told to slow down.
 *
 * Spec: specs/ai-gateway/governance/cli-login.feature
 */
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { resetDeviceApprovalSubscriber } from "../_lib/device-approval-signal";
import { app, approveDeviceCode, denyDeviceCode } from "../auth-cli";

const suffix = nanoid(8);
const USER_ID = `usr-approval-${suffix}`;
const ORG_ID = `org-approval-${suffix}`;

async function mintDeviceCode(): Promise<string> {
  const res = await app.request("/api/auth/cli/device-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (res.status !== 200) {
    throw new Error(`/device-code answered ${res.status}`);
  }
  const body = (await res.json()) as { device_code: string };
  return body.device_code;
}

function callExchange(deviceCode: string) {
  return app.request("/api/auth/cli/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
  });
}

function openApprovalStream(deviceCode: string) {
  return app.request(
    `/api/auth/cli/device-approval?device_code=${encodeURIComponent(deviceCode)}`,
    { headers: { accept: "text/event-stream" } },
  );
}

/** The first frame carrying a payload, or null if the stream ends without one. */
async function readFirstFrame(res: Response): Promise<string | null> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return null;
      buffered += decoder.decode(value, { stream: true });
      const frame = /^data: *(\{.*\})/m.exec(buffered);
      if (frame) return frame[1] ?? null;
    }
  } finally {
    await reader.cancel().catch(() => {
      // The stream is already going away.
    });
  }
}

/** Wait until the stream handler has actually subscribed to its channel. */
async function waitForSubscriber(
  redis: Redis,
  deviceCode: string,
): Promise<void> {
  const channel = `lwcli:device-settled:${deviceCode}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    const channels = (await redis.pubsub("CHANNELS", channel)) as string[];
    if (channels.includes(channel)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the approval stream never subscribed to ${channel}`);
}

describe("CLI device-approval stream", () => {
  let redisConnection: Redis | null = null;

  beforeAll(async () => {
    ({ redisConnection } = await startTestContainers());
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({ redis: redisConnection });
  });

  afterAll(async () => {
    await resetDeviceApprovalSubscriber().catch(() => {});
    await resetApp();
    await stopTestContainers().catch(() => {});
  });

  describe("when the browser approves while the CLI is on the stream", () => {
    /** @scenario "The approval stream tells the CLI to poll the moment the browser settles the code" */
    it("emits the settled status without waiting for a poll", async () => {
      const deviceCode = await mintDeviceCode();
      const stream = await openApprovalStream(deviceCode);
      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type")).toContain("text/event-stream");

      await waitForSubscriber(redisConnection!, deviceCode);
      await approveDeviceCode({
        deviceCode,
        userId: USER_ID,
        organizationId: ORG_ID,
      });

      expect(await readFirstFrame(stream)).toBe('{"status":"approved"}');
    });
  });

  describe("when the code settled before the CLI opened the stream", () => {
    /** @scenario "The approval stream tells the CLI to poll the moment the browser settles the code" */
    it("emits at once rather than holding the connection open", async () => {
      const deviceCode = await mintDeviceCode();
      await approveDeviceCode({
        deviceCode,
        userId: USER_ID,
        organizationId: ORG_ID,
      });

      const stream = await openApprovalStream(deviceCode);
      expect(await readFirstFrame(stream)).toBe('{"status":"approved"}');
    });
  });

  describe("when the device code is unknown", () => {
    /** @scenario "The approval stream tells the CLI to poll the moment the browser settles the code" */
    it("says expired instead of holding a stream nothing will ever settle", async () => {
      const stream = await openApprovalStream(`missing-${suffix}`);
      expect(await readFirstFrame(stream)).toBe('{"status":"expired"}');
    });

    it("refuses a request with no device_code", async () => {
      const res = await app.request("/api/auth/cli/device-approval", {
        headers: { accept: "text/event-stream" },
      });
      expect(res.status).toBe(400);
    });
  });

  describe("when the CLI polls straight after the stream told it to", () => {
    /** @scenario "A poll on a settled device code is answered, not rate limited" */
    it("answers the settled code instead of asking it to slow down", async () => {
      const deviceCode = await mintDeviceCode();

      expect((await callExchange(deviceCode)).status).toBe(428);
      // Still pending, so the poll window is what a second poll gets.
      expect((await callExchange(deviceCode)).status).toBe(429);

      await denyDeviceCode(deviceCode);

      // Inside the same window, but the code has settled: this is the poll
      // the stream just asked for, and it gets its answer.
      expect((await callExchange(deviceCode)).status).toBe(410);
    });
  });
});
