/**
 * The REST mapping of the two system-prompt refusals onto their statuses,
 * pinned by #3196 so a refactor cannot regress it. The toast forwards
 * `error.message`, which is why the "friendly message, no stack trace" assertion lives here.
 */

import { SystemPromptConflictError, SystemPromptRequiredError } from "@langwatch/prompt-contract";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { handleSystemPromptHandledErrors } from "../prompt.rest.ts";

/** Runs `fn`, returning what it threw, or fails the test if it did not throw. */
function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("Expected handleSystemPromptHandledErrors to throw");
}

describe("handleSystemPromptHandledErrors", () => {
  describe("when given a SystemPromptRequiredError (Issue #3196)", () => {
    /** @scenario "Toast on server-side validation failure shows a friendly message" */
    it("throws an HTTPException(400) with the friendly user-facing message", () => {
      const domainError = new SystemPromptRequiredError();
      const err = thrownBy(() => handleSystemPromptHandledErrors(domainError));
      expect(err).toBeInstanceOf(HTTPException);
      const httpError = err as HTTPException;
      expect(httpError.status).toBe(400);
      // The status and the domain error's own `code` are the contract; the
      // message beside them is copy and has already been reworded once.
      expect(domainError.code).toBe("prompt_system_prompt_required");
      expect(httpError.message).toBe(domainError.message);
      // The user-facing message must not contain class names or stack
      // frames — the toast forwards `error.message` verbatim (AC 6).
      expect(httpError.message).not.toMatch(/SystemPromptConflictError/);
      expect(httpError.message).not.toMatch(/SystemPromptRequiredError/);
      expect(httpError.cause).toBe(domainError);
    });
  });

  describe("when given a SystemPromptConflictError (AC 5 regression guard)", () => {
    it("throws an HTTPException(409) with the friendly user-facing message", () => {
      const domainError = new SystemPromptConflictError();
      const err = thrownBy(() => handleSystemPromptHandledErrors(domainError));
      expect(err).toBeInstanceOf(HTTPException);
      const httpError = err as HTTPException;
      expect(httpError.status).toBe(409);
      expect(domainError.code).toBe("prompt_system_prompt_conflict");
      expect(httpError.message).toBe(domainError.message);
      expect(httpError.message).not.toMatch(/SystemPromptConflictError/);
      expect(httpError.cause).toBe(domainError);
    });
  });

  describe("when given any other error", () => {
    it("returns without throwing so the global error middleware can handle it", () => {
      expect(() => handleSystemPromptHandledErrors(new Error("Unrelated"))).not.toThrow();
    });

    it("returns without throwing for non-Error inputs", () => {
      expect(() => handleSystemPromptHandledErrors(null)).not.toThrow();
      expect(() => handleSystemPromptHandledErrors(undefined)).not.toThrow();
      expect(() => handleSystemPromptHandledErrors("string error")).not.toThrow();
    });
  });
});
