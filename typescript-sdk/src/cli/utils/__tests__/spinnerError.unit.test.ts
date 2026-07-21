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

  describe("when error carries the platform's error shape", () => {
    // `{ error: <code>, message }` is exactly what the shared Hono error handler
    // puts on the wire for a `HandledError`. It used to be flattened back
    // into the sentence "NotFoundError: Record missing", which reads as though
    // the class name were part of the prose. Now the sentence is the sentence and
    // the code is named as a code — which is the whole point: a caller can act on
    // `not_found`, and could only ever have read the string.
    it("leads with the platform's sentence and names the code beneath it", () => {
      const err = { error: "NotFoundError", message: "Record missing" };
      const { spinner, calls } = makeSpinner();
      failSpinner({ spinner, error: err, action: "fetch trace" });

      const rendered = stripAnsi(String(calls[0]));
      expect(rendered.split("\n")[0]).toBe("Failed to fetch trace: Record missing");
      // The Details block renders key/value pairs without a colon ("code  X").
      expect(rendered).toMatch(/code\s+NotFoundError/);
    });
  });

  describe("when error is a non-ApiError class with a 'Failed to …' message", () => {
    it("still passes through without double-prefixing", () => {
      class PromptsError extends Error {
        constructor(msg: string) {
          super(msg);
          this.name = "PromptsError";
        }
      }
      const err = new PromptsError("Failed to sync prompt: Internal server error");
      const { spinner, calls } = makeSpinner();
      failSpinner({ spinner, error: err, action: "sync prompt" });
      expect(stripAnsi(String(calls[0]))).toBe(
        "Failed to sync prompt: Internal server error",
      );
    });
  });
});
