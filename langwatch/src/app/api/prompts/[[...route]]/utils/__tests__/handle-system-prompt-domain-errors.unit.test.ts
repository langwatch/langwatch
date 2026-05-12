/**
 * Unit tests for the REST handler that maps system-prompt DomainErrors
 * thrown by the prompt service to Hono HTTP exceptions.
 *
 * Pinned by Issue #3196 so a future refactor of either error class can
 * not silently regress the 400/409 mapping. The toast at AC 6 sources
 * its copy from this handler's forwarded `error.message`, so the
 * "friendly message, no stack trace" assertion lives here.
 */
import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";

import {
  SystemPromptConflictError,
  SystemPromptRequiredError,
} from "~/server/prompt-config/errors";

import { handleSystemPromptDomainErrors } from "../handle-system-prompt-domain-errors";

describe("handleSystemPromptDomainErrors", () => {
  describe("when given a SystemPromptRequiredError (Issue #3196)", () => {
    /** @scenario "Toast on server-side validation failure shows a friendly message" */
    it("throws an HTTPException(400) with the friendly user-facing message", () => {
      const domainError = new SystemPromptRequiredError();
      try {
        handleSystemPromptDomainErrors(domainError);
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPException);
        const httpError = err as HTTPException;
        expect(httpError.status).toBe(400);
        expect(httpError.message).toBe("System prompt is required.");
        // The user-facing message must not contain class names or stack
        // frames — the toast forwards `error.message` verbatim (AC 6).
        expect(httpError.message).not.toMatch(/SystemPromptConflictError/);
        expect(httpError.message).not.toMatch(/SystemPromptRequiredError/);
        expect(httpError.cause).toBe(domainError);
        return;
      }
      throw new Error("Expected handleSystemPromptDomainErrors to throw");
    });
  });

  describe("when given a SystemPromptConflictError (AC 5 regression guard)", () => {
    it("throws an HTTPException(409) with the friendly user-facing message", () => {
      const domainError = new SystemPromptConflictError();
      try {
        handleSystemPromptDomainErrors(domainError);
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPException);
        const httpError = err as HTTPException;
        expect(httpError.status).toBe(409);
        expect(httpError.message).toBe(
          "System prompt and prompt cannot be set at the same time",
        );
        expect(httpError.cause).toBe(domainError);
        return;
      }
      throw new Error("Expected handleSystemPromptDomainErrors to throw");
    });
  });

  describe("when given any other error", () => {
    it("returns without throwing so the global error middleware can handle it", () => {
      expect(() =>
        handleSystemPromptDomainErrors(new Error("Unrelated")),
      ).not.toThrow();
    });

    it("returns without throwing for non-Error inputs", () => {
      expect(() => handleSystemPromptDomainErrors(null)).not.toThrow();
      expect(() => handleSystemPromptDomainErrors(undefined)).not.toThrow();
      expect(() =>
        handleSystemPromptDomainErrors("string error"),
      ).not.toThrow();
    });
  });
});
