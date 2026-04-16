import { describe, it, expect, vi } from "vitest";
import type { Ora } from "ora";
import { failSpinner } from "../spinnerError";

const makeSpinner = () => {
  const calls: unknown[] = [];
  const spinner = {
    fail: vi.fn((msg) => {
      calls.push(msg);
      return spinner;
    }),
  } as unknown as Ora;
  return { spinner, calls };
};

// Stripping ANSI color codes keeps assertions focused on message content
// rather than `chalk`'s terminal escape sequences.
const stripAnsi = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\u001b\[[0-9;]*m/g, "");

describe("failSpinner", () => {
  describe("when error is a service-layer *ApiError already prefixed with 'Failed to …'", () => {
    it("uses the error message as-is (no double prefix)", () => {
      class AgentsApiError extends Error {
        constructor(msg: string) {
          super(msg);
          this.name = "AgentsApiError";
        }
      }
      const err = new AgentsApiError(
        "Failed to list agents: Unauthorized: Invalid API key",
      );
      const { spinner, calls } = makeSpinner();
      failSpinner({ spinner, error: err, action: "fetch agents" });
      expect(stripAnsi(String(calls[0]))).toBe(
        "Failed to list agents: Unauthorized: Invalid API key",
      );
    });
  });

  describe("when error is a *ApiError without the 'Failed to …' prefix", () => {
    it("prefixes the action to avoid losing context", () => {
      class SomeApiError extends Error {
        constructor(msg: string) {
          super(msg);
          this.name = "SomeApiError";
        }
      }
      const err = new SomeApiError("boom");
      const { spinner, calls } = makeSpinner();
      failSpinner({ spinner, error: err, action: "reticulate splines" });
      expect(stripAnsi(String(calls[0]))).toBe(
        "Failed to reticulate splines: boom",
      );
    });
  });

  describe("when error is a generic Error", () => {
    it("prefixes the action description", () => {
      const err = new Error("fetch failed");
      const { spinner, calls } = makeSpinner();
      failSpinner({ spinner, error: err, action: "list monitors" });
      expect(stripAnsi(String(calls[0]))).toBe(
        "Failed to list monitors: fetch failed",
      );
    });
  });

  describe("when error is an unstructured object", () => {
    it("routes through formatApiErrorMessage", () => {
      const err = { error: "NotFoundError", message: "Record missing" };
      const { spinner, calls } = makeSpinner();
      failSpinner({ spinner, error: err, action: "fetch trace" });
      expect(stripAnsi(String(calls[0]))).toBe(
        "Failed to fetch trace: NotFoundError: Record missing",
      );
    });
  });
});
