/**
 * Regression test for Issue #3196 / Bug 3.
 *
 * Today, when `prompts.create` is called with neither `prompt` nor a system
 * message in `messages`, the server throws `SystemPromptConflictError` with
 * no `httpStatus` field. The tRPC `domainErrorMiddleware` doesn't recognise
 * it as a `DomainError`, so the call bubbles up as INTERNAL_SERVER_ERROR
 * (HTTP 500) and is captured as an "uncaught" bug.
 *
 * After the fix:
 *   - A dedicated `SystemPromptRequiredError` (extends `DomainError`,
 *     `httpStatus: 400`) is thrown for the missing-system-prompt case.
 *   - The original `SystemPromptConflictError` (both prompt + system
 *     message set) is preserved as a separate, still-409 `DomainError`.
 *   - The middleware auto-maps both to the correct tRPC codes
 *     (BAD_REQUEST and CONFLICT) — no manual try/catch in the router.
 *
 * This test runs at the service layer (no DB / tRPC plumbing) so the
 * regression signal is fast and atomic. The integration coverage that
 * follows verifies the BAD_REQUEST mapping end-to-end via `appRouter`.
 */
import { describe, expect, it, vi } from "vitest";

import { DomainError } from "~/server/app-layer/domain-error";
import { PromptService } from "~/server/prompt-config/prompt.service";
import { PromptVersionService } from "~/server/prompt-config/prompt-version.service";

vi.mock("~/server/prompt-config/repositories");

describe("PromptService.createPrompt — missing system prompt (Issue #3196 regression)", () => {
  /** @scenario "prompts.create returns 400 BAD_REQUEST when both prompt and system message are missing" */
  it("throws a DomainError with httpStatus 400 and kind 'system_prompt_required' when no prompt and no system message are supplied", async () => {
    const service = new PromptService({} as any);
    (service as any).repository = {
      createConfigWithInitialVersion: vi.fn(),
    };
    (service as any).versionService = {
      assertNoSystemPromptConflict: vi.fn(),
    };
    (service as any).getOrganizationIdFromProjectId = vi
      .fn()
      .mockResolvedValue("org-1");

    const error = await captureError(() =>
      service.createPrompt({
        projectId: "project-1",
        handle: "missing-system-prompt",
        messages: [{ role: "user", content: "{{input}}" }],
      }),
    );

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).kind).toBe("system_prompt_required");
    expect((error as DomainError).httpStatus).toBe(400);
    expect((error as Error).message).toMatch(/system prompt is required/i);
    expect((error as Error).message).not.toMatch(/SystemPromptConflictError/);
  });

  /** @scenario "prompts.create still rejects when both prompt and a system message are provided (existing conflict preserved)" */
  it("still throws a DomainError with httpStatus 409 when both prompt and a system message are provided (no regression on AC 5)", async () => {
    const service = new PromptService({} as any);
    (service as any).repository = {
      createConfigWithInitialVersion: vi.fn(),
    };
    // Use the real PromptVersionService so we exercise the real conflict
    // error class, not a synthetic mock. This guards against regression on
    // AC 5 — both prompt + system message together must still throw the
    // existing 409 conflict error.
    (service as any).versionService = new PromptVersionService({} as any);
    (service as any).getOrganizationIdFromProjectId = vi
      .fn()
      .mockResolvedValue("org-1");

    const error = await captureError(() =>
      service.createPrompt({
        projectId: "project-1",
        handle: "conflicting-prompt",
        prompt: "You are a helpful assistant.",
        messages: [{ role: "system", content: "You are a helpful assistant." }],
      }),
    );

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).kind).toBe("system_prompt_conflict");
    expect((error as DomainError).httpStatus).toBe(409);
  });
});

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("Expected fn to throw, but it resolved.");
}
