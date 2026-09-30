/**
 * The ACME checkout demo, booted from a harness copy with only an OpenAI key
 * and driven over HTTP through one guest checkout.
 *
 * It needs `uv`, the network for `uv sync`, and an OpenAI key in the
 * environment or in `platform/app/.env`. The platform is not involved: this
 * is the application as a customer would run it before Langy touches it.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run acme-checkout-demo.e2e.test.ts --reporter=verbose
 *
 * @see specs/setup/acme-checkout-demo.feature
 */

import { type ChildProcess, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDemoRepo,
  type DemoRepo,
  freePort,
  openaiKey,
} from "./local-control-fixture";

const BOOT_TIMEOUT_MS = 600_000;
const TURN_TIMEOUT_MS = 300_000;
const ORDER_NUMBER = /^ACME-[0-9A-F]{6}$/;

interface ChatReply {
  output: string;
  thread_id: string;
  order_number: string | null;
}

let repo: DemoRepo;
let server: ChildProcess | undefined;
let base = "";
let serverLog = "";

async function chat(threadId: string, content: string): Promise<ChatReply> {
  const response = await fetch(`${base}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      thread_id: threadId,
      messages: [{ role: "user", content }],
    }),
  });
  if (response.status !== 200) {
    throw new Error(
      `POST /chat answered ${response.status}: ${await response.text()}`,
    );
  }
  const reply = (await response.json()) as ChatReply;
  console.log(`[${threadId}] > ${content}\n[${threadId}] < ${reply.output}`);
  return reply;
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`the demo exited with ${server.exitCode}:\n${serverLog}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the demo never answered /health:\n${serverLog}`);
}

describe("the ACME checkout demo", () => {
  beforeAll(async () => {
    repo = await createDemoRepo({
      language: "langgraph",
      name: "checkout-demo",
    });
    // The README's own setup: the key in `.env`, nothing else. The process
    // gets only what a shell needs to find uv and its Python.
    await fs.writeFile(
      path.join(repo.root, ".env"),
      `OPENAI_API_KEY=${openaiKey()}\n`,
      "utf8",
    );
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(
      "uv",
      ["run", "uvicorn", "app.main:app", "--port", String(port)],
      {
        cwd: repo.root,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout?.on("data", (chunk: Buffer) => {
      serverLog += chunk.toString();
    });
    server.stderr?.on("data", (chunk: Buffer) => {
      serverLog += chunk.toString();
    });
    await waitForHealth();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    server?.kill("SIGTERM");
    await fs.rm(path.join(repo.root, ".env"), { force: true });
  });

  describe("when it is started with only an OpenAI key", () => {
    /** @scenario The application boots with only an OpenAI key */
    it("answers ok on /health and never mentions the platform", async () => {
      const response = await fetch(`${base}/health`);

      expect(await response.json()).toEqual({ status: "ok" });
      expect(await fs.readFile(path.join(repo.root, ".env"), "utf8")).toMatch(
        /^OPENAI_API_KEY=\S+\n$/,
      );
      expect(serverLog).not.toMatch(/langwatch/i);
    });
  });

  describe("when a guest goes from the cart to an order", () => {
    /** @scenario A guest completes a checkout in one conversation */
    it(
      "lists the cart, refuses the expired code, takes the valid one, charges the card and gives an order number",
      async () => {
        const thread = `checkout-${Date.now().toString(36)}`;

        const cart = await chat(thread, "Hi, what is in my cart?");
        expect(cart.output).toMatch(/Blue Mug/i);
        expect(cart.output).toMatch(/Desk Lamp/i);
        expect(cart.output).toContain("144.40");
        expect(cart.order_number).toBeNull();

        const expired = await chat(thread, "Apply the code SPRING25 please");
        expect(expired.output).toMatch(/expired/i);
        expect(expired.output).not.toContain("130.65");

        const unchanged = await chat(thread, "What is the total now?");
        expect(unchanged.output).toContain("144.40");

        const discounted = await chat(thread, "Try WELCOME10 instead");
        expect(discounted.output).toMatch(/WELCOME10/i);
        expect(discounted.output).toContain("130.65");

        const paid = await chat(
          thread,
          "Pay with card 4242 4242 4242 4242, expiry 12/28, name Ada Lovelace",
        );
        expect(paid.output).toMatch(/paid|payment|charged/i);
        expect(paid.output).not.toMatch(/declined/i);

        const placed = await chat(thread, "Place the order");
        expect(placed.order_number).toMatch(ORDER_NUMBER);
        expect(placed.output).toContain(placed.order_number);
      },
      TURN_TIMEOUT_MS * 6,
    );
  });

  describe("when the card is declined", () => {
    /** @scenario A declined card does not produce an order */
    it(
      "says so, and placing the order still gives no order number",
      async () => {
        const thread = `declined-${Date.now().toString(36)}`;

        const declined = await chat(
          thread,
          "Pay with card 4000 0000 0000 0000, expiry 12/28, name Ada Lovelace",
        );
        expect(declined.output).toMatch(/declined/i);
        expect(declined.order_number).toBeNull();

        const placed = await chat(thread, "Place the order anyway");
        expect(placed.order_number).toBeNull();
        expect(placed.output).toMatch(/pay|payment/i);
      },
      TURN_TIMEOUT_MS * 2,
    );
  });
});
