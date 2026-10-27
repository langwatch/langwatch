/** @see specs/upgrade/upgrade-stuck-states-gate.feature */
import { createErrorHandler } from "@langwatch/api";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { upgradeGateComponent, type UpgradeGateVerdict } from "../upgrade-gate.ts";

const logger = { info: vi.fn(), error: vi.fn() };
const missingTable = () =>
  Object.assign(new Error("The table `public.NewThing` does not exist"), { code: "P2021" });

async function statusOfMissingTableRead(): Promise<number> {
  const app = new Hono();
  app.get("/read", () => {
    throw missingTable();
  });
  app.onError(createErrorHandler());
  return (await app.request("/read")).status;
}

describe("a read of a missing table while the api's gate asks", () => {
  /** @scenario "A missing table on a ledger that says current is not reported as upgrading" */
  it("answers 503 until the gate admits, 500 while admitted, and 503 again after stop", async () => {
    const verdicts: UpgradeGateVerdict[] = [
      { admitted: false, outcome: "upgrading", outstanding: ["prisma:20261006180000_add"] },
      { admitted: true },
    ];
    const component = upgradeGateComponent({
      server: "langwatch-api",
      role: "api",
      gate: { admit: async () => verdicts.shift() ?? { admitted: true }, release: async () => {} },
      logger,
      reAskMs: 5,
    });

    await component.start?.();
    expect(await statusOfMissingTableRead()).toBe(503);

    await vi.waitFor(() => expect(component.ready?.()).resolves.toBeUndefined());
    expect(await statusOfMissingTableRead()).toBe(500);

    await component.stop();
    expect(await statusOfMissingTableRead()).toBe(503);
  });
});
