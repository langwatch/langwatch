import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted: `vi.mock` factories run before module-level consts are initialised.
const { mockError } = vi.hoisted(() => ({ mockError: vi.fn() }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    error: mockError,
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
  }),
}));

import { BestEffortService } from "../src/index";

const bestEffort = BestEffortService.create();

describe("bestEffort()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a logger that accepts the line", () => {
    describe("when the side effect succeeds", () => {
      it("runs it and logs nothing", async () => {
        const run = vi.fn().mockResolvedValue(undefined);

        await bestEffort.run({ label: "a notification", effect: run });

        expect(run).toHaveBeenCalledOnce();
        expect(mockError).not.toHaveBeenCalled();
      });
    });

    describe("when the side effect throws synchronously", () => {
      it("resolves and records the failure", async () => {
        const boom = new Error("boom");

        await expect(
          bestEffort.run({
            label: "a notification",
            effect: () => {
              throw boom;
            },
          }),
        ).resolves.toBeUndefined();

        expect(mockError).toHaveBeenCalledWith(
          expect.objectContaining({ err: boom }),
          "[bestEffort] a notification failed",
        );
      });
    });

    // The one that matters. Dropping the `await` inside the wrapper leaves the
    // caller resolving cleanly while the rejection escapes as an unhandled
    // promise, so "the handler did not throw" passes either way. Asserting the
    // failure was LOGGED is what distinguishes handled from merely invisible.
    describe("when the side effect rejects asynchronously", () => {
      it("resolves and records the failure rather than letting it escape", async () => {
        const boom = new Error("slack is down");

        await expect(
          bestEffort.run({
            label: "a notification",
            effect: () => Promise.reject(boom),
          }),
        ).resolves.toBeUndefined();

        expect(mockError).toHaveBeenCalledWith(
          expect.objectContaining({ err: boom }),
          "[bestEffort] a notification failed",
        );
      });
    });

    describe("when context is supplied", () => {
      it("carries it into the log line beside the error", async () => {
        await bestEffort.run({
          label: "a notification",
          context: { subscriptionId: "sub_db_1" },
          effect: () => Promise.reject(new Error("boom")),
        });

        expect(mockError).toHaveBeenCalledWith(
          expect.objectContaining({ subscriptionId: "sub_db_1" }),
          expect.any(String),
        );
      });
    });
  });

  // A logger is not a guaranteed-safe call: serialising the error runs whatever
  // getters it carries, and a transport can be closed under us. Reporting a
  // failure must not become one, or the webhook returns 5xx and Stripe replays
  // the whole handler for the sake of a log line.
  describe("given a logger whose error() throws", () => {
    beforeEach(() => {
      mockError.mockImplementation(() => {
        throw new Error("transport closed");
      });
    });

    describe("when the side effect fails", () => {
      it("still resolves rather than failing its caller", async () => {
        await expect(
          bestEffort.run({
            label: "a notification",
            effect: () => Promise.reject(new Error("slack is down")),
          }),
        ).resolves.toBeUndefined();

        expect(mockError).toHaveBeenCalledOnce();
      });
    });
  });
});
