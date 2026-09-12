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
 *     instead of being told to slow down, and takes an exclusive redemption
 *     claim instead, so two polls arriving together still redeem the approval
 *     once.
 *
 * Spec: specs/ai-gateway/governance/cli-login.feature
 */
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import {
  publishDeviceCodeSettled,
  resetDeviceApprovalSubscriber,
  waitForDeviceCodeSettled,
} from "../_lib/device-approval-signal";
import { app, approveDeviceCode, denyDeviceCode } from "../auth-cli";

const suffix = nanoid(8);
const USER_ID = `usr-approval-${suffix}`;
const ORG_ID = `org-approval-${suffix}`;
const PROJECT_ID = `proj-approval-${suffix}`;
const PROJECT_API_KEY = `sk-lw-approval-${suffix}-${"a".repeat(36)}`;

async function mintDeviceCode(
  request: Record<string, unknown> = {},
): Promise<string> {
  const res = await app.request("/api/auth/cli/device-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
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
async function waitForSubscriber({
  redis,
  deviceCode,
}: {
  redis: Redis;
  deviceCode: string;
}): Promise<void> {
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

    // The redemption path re-derives membership from Postgres, so the user and
    // org the approvals below name have to exist for an exchange to reach 200.
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `Approval Org ${suffix}`,
        slug: `approval-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `approval-${suffix}@example.com`,
        name: `Approval ${suffix}`,
      },
    });
    await prisma.organizationUser.create({
      data: { userId: USER_ID, organizationId: ORG_ID, role: "ADMIN" },
    });
  });

  afterAll(async () => {
    await resetDeviceApprovalSubscriber().catch(() => {});
    await resetApp();
    await prisma.organizationUser
      .deleteMany({ where: { userId: USER_ID, organizationId: ORG_ID } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: USER_ID } }).catch(() => {});
    await prisma.organization
      .deleteMany({ where: { id: ORG_ID } })
      .catch(() => {});
    await stopTestContainers().catch(() => {});
  });

  describe("given a device code the CLI is waiting on", () => {
    describe("when the browser approves while the CLI is on the stream", () => {
      /** @scenario "The approval stream tells the CLI to poll the moment the browser settles the code" */
      it("emits the settled status without waiting for a poll", async () => {
        const deviceCode = await mintDeviceCode();
        const stream = await openApprovalStream(deviceCode);
        expect(stream.status).toBe(200);
        expect(stream.headers.get("content-type")).toContain(
          "text/event-stream",
        );

        await waitForSubscriber({ redis: redisConnection!, deviceCode });
        await approveDeviceCode({
          deviceCode,
          userId: USER_ID,
          organizationId: ORG_ID,
        });

        expect(await readFirstFrame(stream)).toBe('{"status":"approved"}');
      });
    });

    describe("when the browser denies while the CLI is on the stream", () => {
      /** @scenario "The approval stream tells the CLI to poll the moment the browser settles the code" */
      it("emits denied, so the CLI stops instead of waiting the code out", async () => {
        const deviceCode = await mintDeviceCode();
        const stream = await openApprovalStream(deviceCode);

        await waitForSubscriber({ redis: redisConnection!, deviceCode });
        await denyDeviceCode(deviceCode);

        expect(await readFirstFrame(stream)).toBe('{"status":"denied"}');
      });
    });

    describe("when the code settles while the stream is still subscribing", () => {
      /** @scenario "A publication is lost if the stream has not subscribed yet" */
      it("is a window a publication falls into, since pub/sub keeps nothing for a late subscriber", async () => {
        const deviceCode = await mintDeviceCode();
        const abort = new AbortController();

        // The premise the re-read exists for, pinned on its own so it cannot
        // rot silently: publish first, subscribe after, and the subscriber
        // hears nothing. Redis has no replay for a channel.
        await publishDeviceCodeSettled({
          redis: redisConnection!,
          deviceCode,
          status: "approved",
        });
        const watch = waitForDeviceCodeSettled({
          redis: redisConnection!,
          deviceCode,
          signal: abort.signal,
        });
        await watch.subscribed;

        const heard = await Promise.race([
          watch.settled,
          new Promise((resolve) => setTimeout(() => resolve("nothing"), 250)),
        ]);
        abort.abort();

        expect(heard).toBe("nothing");
      });

      /** @scenario "A publication is lost if the stream has not subscribed yet" */
      it("is closed by `subscribed`, which resolves only once the channel is live", async () => {
        const deviceCode = await mintDeviceCode();
        const abort = new AbortController();

        // The other half of the boundary, and the reason re-reading after
        // `subscribed` is enough on its own: from that point on, every
        // publication is heard. So the gap the re-read has to cover is exactly
        // [the route's first read, `subscribed`], with nothing after it.
        const watch = waitForDeviceCodeSettled({
          redis: redisConnection!,
          deviceCode,
          signal: abort.signal,
        });
        await watch.subscribed;
        await publishDeviceCodeSettled({
          redis: redisConnection!,
          deviceCode,
          status: "approved",
        });

        expect(await watch.settled).toBe("approved");
        abort.abort();
      });

      /** @scenario "The approval stream tells the CLI to poll the moment the browser settles the code" */
      it("emits anyway, because the stream re-reads once its channel is live", async () => {
        const deviceCode = await mintDeviceCode();

        // Dropping the pod's subscriber makes the route open a fresh one, so
        // its subscribe costs a connection handshake while the approval below
        // runs on a connection that is already up. That is what puts the
        // publication in the window between the route's first read and its
        // subscribe, the window the re-read covers. Losing the race would only
        // make this test less sensitive, never wrong: the frame is the claim.
        await resetDeviceApprovalSubscriber();

        const [stream] = await Promise.all([
          openApprovalStream(deviceCode),
          approveDeviceCode({
            deviceCode,
            userId: USER_ID,
            organizationId: ORG_ID,
          }),
        ]);

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

    describe("when two polls for the same approval arrive together", () => {
      /** @scenario "Two exchanges racing the same approval redeem it once" */
      it("hands the credential to one of them and tells the other to slow down", async () => {
        const deviceCode = await mintDeviceCode({
          credential_type: "project_api_key",
        });
        await approveDeviceCode({
          deviceCode,
          userId: USER_ID,
          organizationId: ORG_ID,
          projectApiKey: {
            project_id: PROJECT_ID,
            project_slug: `approval-proj-${suffix}`,
            project_name: `Approval Project ${suffix}`,
            api_key: PROJECT_API_KEY,
          },
        });

        // A settled code skips the poll window, so nothing else stands between
        // these two: without the redemption claim both reach the credential.
        const [first, second] = await Promise.all([
          callExchange(deviceCode),
          callExchange(deviceCode),
        ]);

        expect([first.status, second.status].sort()).toEqual([200, 429]);

        const winner = first.status === 200 ? first : second;
        const loser = first.status === 200 ? second : first;
        expect(((await winner.json()) as { api_key: string }).api_key).toBe(
          PROJECT_API_KEY,
        );
        expect(((await loser.json()) as { error: string }).error).toBe(
          "slow_down",
        );
      });
    });
  });

  describe("given a request the stream can do nothing for", () => {
    describe("when the device code is unknown", () => {
      /** @scenario "The approval stream tells the CLI to poll the moment the browser settles the code" */
      it("says expired instead of holding a stream nothing will ever settle", async () => {
        const stream = await openApprovalStream(`missing-${suffix}`);
        expect(await readFirstFrame(stream)).toBe('{"status":"expired"}');
      });
    });

    describe("when no device_code is given", () => {
      it("refuses the request", async () => {
        const res = await app.request("/api/auth/cli/device-approval", {
          headers: { accept: "text/event-stream" },
        });
        expect(res.status).toBe(400);
      });
    });
  });
});
