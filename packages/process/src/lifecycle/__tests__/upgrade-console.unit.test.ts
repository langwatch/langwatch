/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { createHash } from "node:crypto";
import http from "node:http";
import { hostname } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LIVENESS_PATH,
  UPGRADE_CONSOLE_PATH,
  UPGRADE_RETRY_PATH,
  startHeartbeat,
  startLivenessThread,
  type Heartbeat,
  type LivenessThread,
  type UpgradeConsole,
} from "../liveness-thread.ts";

const TOKEN = "the-printed-console-token";
const threads: LivenessThread[] = [];
const heartbeats: Heartbeat[] = [];
const listeners: http.Server[] = [];

afterEach(async () => {
  await Promise.all(threads.splice(0).map((thread) => thread.close({ graceMs: 50 })));
  for (const heartbeat of heartbeats.splice(0)) heartbeat.stop();
  for (const listener of listeners.splice(0)) {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});

async function bootThread(): Promise<LivenessThread> {
  const listener = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "text/plain" }).end("main");
  });
  listeners.push(listener);
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (address === null || typeof address === "string") throw new Error("no loopback port");
  const heartbeat = startHeartbeat({ intervalMs: 5 });
  heartbeats.push(heartbeat);
  const thread = await startLivenessThread({
    port: 0,
    heartbeat: heartbeat.buffer,
    proxyPort: address.port,
    logger: { info: vi.fn(), error: vi.fn() },
  });
  threads.push(thread);
  return thread;
}

const failedConsole = ({ tokenTtlMs = 60_000 } = {}): UpgradeConsole => ({
  failedSteps: [{ id: "dataset:move-to-storage", error: "lock timeout on Dataset" }],
  logTail: ["[upgrade] dataset:move-to-storage failed after 3 s"],
  tokenSha256: createHash("sha256").update(TOKEN).digest("hex"),
  tokenTtlMs,
});

const urlOf = (thread: LivenessThread, path: string): string =>
  `http://127.0.0.1:${thread.address.port}${path}`;
const browse = (thread: LivenessThread, cookie?: string) =>
  fetch(urlOf(thread, "/settings"), {
    headers: { Accept: "text/html", ...(cookie === undefined ? {} : { Cookie: cookie }) },
  });
const post = (
  thread: LivenessThread,
  path: string,
  form: Record<string, string>,
  cookie?: string,
  headers: Record<string, string> = {},
) =>
  fetch(urlOf(thread, path), {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "text/html",
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie === undefined ? {} : { Cookie: cookie }),
      ...headers,
    },
    body: new URLSearchParams(form).toString(),
  });
const submit = (thread: LivenessThread, token: string) =>
  post(thread, UPGRADE_CONSOLE_PATH, { token });

/** Shows the console and waits until the thread answers with it; `retried` settles on Retry. */
async function showConsole(thread: LivenessThread, upgradeConsole = failedConsole()) {
  const retried = thread.holdConsole(upgradeConsole);
  await vi.waitFor(async () =>
    expect(await (await browse(thread)).text()).toContain("needs an operator"),
  );
  return { retried };
}

async function openSession(thread: LivenessThread): Promise<string> {
  const opened = await submit(thread, TOKEN);
  expect(opened.status).toBe(303);
  return (opened.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const settledWithin = (promise: Promise<boolean>, ms: number) =>
  Promise.race([
    promise,
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);

describe("the upgrade console", () => {
  describe("given the api's upgrade failed", () => {
    describe("when a browser asks for a page without a console session", () => {
      /** @scenario "The holding page of a failed upgrade asks for the token and shows no failure detail" */
      it("answers 503 asking for the token and names no step, error or host", async () => {
        const thread = await bootThread();
        await showConsole(thread);

        const response = await browse(thread);
        const body = await response.text();

        expect(response.status).toBe(503);
        expect(body).toContain("needs an operator");
        expect(body).toContain(`action="${UPGRADE_CONSOLE_PATH}"`);
        expect(body).not.toContain("dataset:move-to-storage");
        expect(body).not.toContain("lock timeout");
        expect(body).not.toContain(hostname());
      });
    });

    describe("when an operator submits the printed token", () => {
      /** @scenario "The right token opens the upgrade console" */
      it("swaps it for a strict HttpOnly cookie that shows the failure, its log and Retry", async () => {
        const thread = await bootThread();
        await showConsole(thread);

        const opened = await submit(thread, TOKEN);
        const setCookie = opened.headers.get("set-cookie") ?? "";
        const cookie = setCookie.split(";")[0] ?? "";
        const page = await (await browse(thread, cookie)).text();

        expect(opened.status).toBe(303);
        expect(setCookie).toContain("HttpOnly");
        expect(setCookie).toContain("SameSite=Strict");
        expect(setCookie).not.toContain(TOKEN);
        expect(page).toContain("dataset:move-to-storage");
        expect(page).toContain("lock timeout on Dataset");
        expect(page).toContain("[upgrade] dataset:move-to-storage failed after 3 s");
        expect(page).toContain(`action="${UPGRADE_RETRY_PATH}"`);
        expect(page).not.toContain(TOKEN);
      });
    });

    describe("when someone submits a different token", () => {
      /** @scenario "A wrong token is refused without detail" */
      it("refuses it with the expired token's answer and keeps the console closed", async () => {
        const thread = await bootThread();
        const expiring = await bootThread();
        await showConsole(thread);
        await showConsole(expiring, failedConsole({ tokenTtlMs: 0 }));
        const wrong = await submit(thread, "a-guess");
        const wrongBody = await wrong.text();
        const expired = await submit(expiring, TOKEN);

        expect(wrong.status).toBe(403);
        expect(wrong.headers.get("set-cookie")).toBeNull();
        expect(expired.status).toBe(403);
        expect(await expired.text()).toBe(wrongBody);
        expect(wrongBody).not.toContain("dataset:move-to-storage");
      });
    });

    describe("when the token is older than its lifetime", () => {
      /** @scenario "An expired token is refused" */
      it("refuses it and says to restart the api for a new token", async () => {
        const thread = await bootThread();
        await showConsole(thread, failedConsole({ tokenTtlMs: 0 }));

        const response = await submit(thread, TOKEN);

        expect(response.status).toBe(403);
        expect(await response.text()).toContain("restart the api to print a new one");
      });
    });

    describe("when the same token is submitted a second time", () => {
      /** @scenario "A token opens the console once" */
      it("refuses it with the expired token's answer", async () => {
        const thread = await bootThread();
        await showConsole(thread);
        await openSession(thread);

        const again = await submit(thread, TOKEN);
        const wrong = await submit(thread, "a-guess");

        expect(again.status).toBe(403);
        expect(again.headers.get("set-cookie")).toBeNull();
        expect(await again.text()).toBe(await wrong.text());
      });
    });

    describe("when five wrong tokens were submitted within a minute", () => {
      /** @scenario "Five wrong tokens in a minute make every submission wait" */
      it("answers the next submission 429, even with the right token", async () => {
        const thread = await bootThread();
        await showConsole(thread);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          expect((await submit(thread, `guess-${attempt}`)).status).toBe(403);
        }

        const response = await submit(thread, TOKEN);

        expect(response.status).toBe(429);
        expect(response.headers.get("set-cookie")).toBeNull();
      });
    });

    describe("when a page on another site or origin submits a token", () => {
      /** @scenario "A token submitted from another site or origin is refused and not counted" */
      it("refuses it, even the right token, and leaves the wrong-token limit untouched", async () => {
        const thread = await bootThread();
        await showConsole(thread);
        const own = `http://127.0.0.1:${thread.address.port}`;
        const fromElsewhere: Record<string, string>[] = [
          { "Sec-Fetch-Site": "cross-site", Origin: "http://drive-by.example" },
          { Origin: "http://drive-by.example" },
          { Origin: "null" },
        ];
        const refused: Response[] = [];
        for (const headers of fromElsewhere) {
          refused.push(
            await post(thread, UPGRADE_CONSOLE_PATH, { token: TOKEN }, undefined, headers),
          );
        }
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const guess = await post(
            thread,
            UPGRADE_CONSOLE_PATH,
            { token: `guess-${attempt}` },
            undefined,
            {
              Origin: "http://drive-by.example",
            },
          );
          expect(guess.status).toBe(403);
        }

        const opened = await post(thread, UPGRADE_CONSOLE_PATH, { token: TOKEN }, undefined, {
          "Sec-Fetch-Site": "same-origin",
          Origin: own,
        });

        expect(refused.map((response) => response.status)).toEqual([403, 403, 403]);
        expect(refused.map((response) => response.headers.get("set-cookie"))).toEqual([
          null,
          null,
          null,
        ]);
        expect(opened.status).toBe(303);
      });
    });

    describe("when a request asks for Retry without the console session", () => {
      /** @scenario "A console action without the console session is refused" */
      it("refuses it and asks for no run", async () => {
        const thread = await bootThread();
        const { retried } = await showConsole(thread);

        const bare = await post(thread, UPGRADE_RETRY_PATH, {});
        const forged = await post(
          thread,
          UPGRADE_RETRY_PATH,
          {},
          "langwatch_upgrade_console=forged",
        );

        expect(bare.status).toBe(403);
        expect(forged.status).toBe(403);
        expect(await settledWithin(retried, 100)).toBe("pending");
      });
    });

    describe("when another site posts Retry with the console session attached", () => {
      /** @scenario "A cross-site Retry is refused even with the console session" */
      let thread: LivenessThread;
      let retried: Promise<boolean>;
      let cookie: string;
      let own: string;

      beforeEach(async () => {
        thread = await bootThread();
        ({ retried } = await showConsole(thread));
        cookie = await openSession(thread);
        own = `http://127.0.0.1:${thread.address.port}`;
      });

      it("refuses a cross-site or foreign-origin Retry and runs only the same-origin one", async () => {
        const crossSite = await post(thread, UPGRADE_RETRY_PATH, {}, cookie, {
          "Sec-Fetch-Site": "same-site",
          Origin: own,
        });
        const foreign = await post(thread, UPGRADE_RETRY_PATH, {}, cookie, {
          Origin: "http://sibling.example",
        });
        const opaque = await post(thread, UPGRADE_RETRY_PATH, {}, cookie, { Origin: "null" });
        const stillPending = await settledWithin(retried, 100);
        const sameOrigin = await post(thread, UPGRADE_RETRY_PATH, {}, cookie, {
          "Sec-Fetch-Site": "same-origin",
          Origin: own,
        });

        expect([crossSite.status, foreign.status, opaque.status]).toEqual([403, 403, 403]);
        expect(stillPending).toBe("pending");
        expect(sameOrigin.status).toBe(303);
        expect(await retried).toBe(true);
      });

      it("accepts a plain-HTTP browser's Retry: Origin equals its own Host, no Sec-Fetch-Site", async () => {
        const pressed = await post(thread, UPGRADE_RETRY_PATH, {}, cookie, { Origin: own });

        expect(pressed.status).toBe(303);
        expect(await retried).toBe(true);
      });
    });

    describe("when a new failed run shows its console", () => {
      /** @scenario "A console session of an earlier failed run does not open the next run's console" */
      it("asks for the new token and refuses the old session's Retry", async () => {
        const thread = await bootThread();
        await showConsole(thread);
        const cookie = await openSession(thread);
        expect((await post(thread, UPGRADE_RETRY_PATH, {}, cookie)).status).toBe(303);
        await thread.hold({ phase: "upgrade-gate", outstandingStepIds: [] });
        const { retried } = await showConsole(thread);

        const page = await (await browse(thread, cookie)).text();
        const pressed = await post(thread, UPGRADE_RETRY_PATH, {}, cookie);

        expect(page).toContain("Enter the console token");
        expect(page).not.toContain("dataset:move-to-storage");
        expect(pressed.status).toBe(403);
        expect(await settledWithin(retried, 100)).toBe("pending");
      });
    });

    describe("when the console session presses Retry and the upgrade then succeeds", () => {
      /** @scenario "Retry from the console runs the upgrade again and serves on success" */
      it("asks for a run, and once the hold lifts neither the console nor its token answers", async () => {
        const thread = await bootThread();
        const { retried } = await showConsole(thread);
        const cookie = await openSession(thread);

        const pressed = await post(thread, UPGRADE_RETRY_PATH, {}, cookie);
        expect(await retried).toBe(true);
        await thread.hold(undefined);
        const page = await browse(thread, cookie);
        const token = await submit(thread, TOKEN);

        expect(pressed.status).toBe(303);
        expect(await page.text()).toBe("main");
        expect(await token.text()).toBe("main");
      });
    });

    describe("when the kubelet asks for the liveness path", () => {
      /** @scenario "Liveness still answers while the console is shown" */
      it("answers 200", async () => {
        const thread = await bootThread();
        await showConsole(thread);

        const response = await fetch(urlOf(thread, LIVENESS_PATH));

        expect(response.status).toBe(200);
      });
    });
  });
});
