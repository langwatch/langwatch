/**
 * @vitest-environment node
 *
 * LANGWATCH_CONNECT_DISABLED is the switch an audit asks for when it has to
 * prove absence rather than derive it from the license: with it set the install
 * opens no connection to LangWatch for any reason. The daily usage report is a
 * connection to LangWatch, so the switch has to stop it, and the docs say so.
 *
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

const findMany = vi.hoisted(() => vi.fn());
vi.mock("~/server/db", () => ({
  prisma: { organization: { findMany } },
}));

// Read inside readConnectConfig on every call (ADR-093), so the switch can be
// flipped per test rather than per file.
const environment = vi.hoisted(() => ({
  DISABLE_USAGE_STATS: false,
  IS_SAAS: false,
  LANGWATCH_CONNECT_DISABLED: false,
}));
vi.mock("~/env.mjs", () => ({ env: environment }));

vi.mock("~/server/collectUsageStats", () => ({
  collectUsageStats: vi.fn(async () => ({})),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: (error: unknown) => error,
  withScope: vi.fn(async (fn: (scope: unknown) => unknown) =>
    fn({ setTag: () => undefined, setExtra: () => undefined }),
  ),
}));

const { startUsageStatsWorker } = await import("../usageStatsWorker");

const DAY_MS = 24 * 60 * 60 * 1000;

describe("the usage stats worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T00:00:00Z"));
    findMany.mockReset();
    findMany.mockResolvedValue([]);
    environment.LANGWATCH_CONNECT_DISABLED = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a deployment that sets LANGWATCH_CONNECT_DISABLED", () => {
    describe("when the install boots", () => {
      /** @scenario "An install told to reach LangWatch for nothing sends no report either" */
      it("starts no scheduler, so no report is ever taken or posted", async () => {
        environment.LANGWATCH_CONNECT_DISABLED = true;

        const handle = startUsageStatsWorker();
        await vi.advanceTimersByTimeAsync(DAY_MS * 3);
        handle?.stop();

        expect(handle).toBeUndefined();
        expect(findMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a deployment that leaves the switch alone", () => {
    describe("when the install boots", () => {
      it("schedules the daily report as before", async () => {
        const handle = startUsageStatsWorker();
        await vi.advanceTimersByTimeAsync(DAY_MS);
        handle?.stop();

        expect(handle).toBeDefined();
        expect(findMany).toHaveBeenCalled();
      });
    });
  });
});
