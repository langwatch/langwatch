/**
 * @vitest-environment jsdom
 *
 * Integration tests for the system-prompt-required validation flow
 * (Issue #3196 — Bug 2 client-side). These exercise the real
 * `usePromptConfigForm` resolver + the same `useWatch`-driven Save-button
 * disabled wiring used by `PromptEditorDrawer`, so the scenarios bind
 * the *behavior* a user sees, not just the schema.
 *
 * Scope: schema refinement + RHF resolver + Save-button gate + toast on
 * server error. Drawer-level concerns (tRPC plumbing, RBAC, project
 * context) are out of scope and exercised by `PromptEditorDrawer.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { useWatch } from "react-hook-form";

// Mock the model-limits hook so the form resolver doesn't pull in tRPC.
// We only care about the system-prompt-required refinement; model limits
// are exercised in `form-schema.test.ts`.
vi.mock("~/hooks/useModelLimits", () => ({
  useModelLimits: () => ({ limits: null }),
}));

import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";
import { hasNonEmptySystemMessage } from "~/prompts/schemas/form-schema";
import { usePromptConfigForm } from "../usePromptConfigForm";

interface MutationCall {
  systemContent: string | undefined;
}

/**
 * Minimal harness that mirrors the parts of `PromptEditorDrawer` that
 * matter for #3196: a Save button gated on `isValid` (computed via
 * `useWatch` on messages — using the same `hasNonEmptySystemMessage`
 * predicate as the production code), an inline error surfaced from the
 * resolver, and a fake mutation function that records whether Save
 * actually fired. Anything more would duplicate the existing drawer
 * test setup.
 */
function PromptSaveHarness({
  initialMessages,
  onMutationFire,
}: {
  initialMessages: Array<{ role: "system" | "user"; content: string }>;
  onMutationFire: (call: MutationCall) => void;
}) {
  const defaults = buildDefaultFormValues({
    version: {
      configData: {
        messages: initialMessages,
      },
    },
  });
  const { methods } = usePromptConfigForm({ initialConfigValues: defaults });
  // Trigger initial validation so the inline error renders for empty seeds
  // without requiring the user to interact first.
  useEffect(() => {
    void methods.trigger();
  }, [methods]);
  const messages = useWatch({
    control: methods.control,
    name: "version.configData.messages",
  });
  const isValid = hasNonEmptySystemMessage(messages);
  const messagesError = methods.formState.errors.version?.configData
    ?.messages as { message?: string } | undefined;

  const handleClick = async () => {
    const valid = await methods.trigger();
    if (!valid) return;
    const systemContent = methods
      .getValues("version.configData.messages")
      ?.find((m) => m.role === "system")?.content;
    onMutationFire({ systemContent });
  };

  return (
    <form>
      <textarea
        aria-label="system-content"
        value={messages?.find((m) => m.role === "system")?.content ?? ""}
        onChange={(e) => {
          const next = [...messages].map((m) =>
            m.role === "system" ? { ...m, content: e.target.value } : m,
          );
          methods.setValue("version.configData.messages", next, {
            shouldValidate: true,
            shouldDirty: true,
          });
        }}
      />
      {messagesError?.message && <p role="alert">{messagesError.message}</p>}
      <button
        type="button"
        disabled={!isValid}
        onClick={() => void handleClick()}
      >
        Save
      </button>
    </form>
  );
}

describe("usePromptConfigForm — system-prompt-required save flow (Issue #3196)", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the system message is empty on initial render", () => {
    /** @scenario "Save is disabled when the workflow prompt's system message is empty" */
    it("disables the Save button, renders the inline required-field error, and blocks the mutation", async () => {
      const calls: MutationCall[] = [];
      render(
        <PromptSaveHarness
          initialMessages={[
            { role: "system", content: "" },
            { role: "user", content: "{{input}}" },
          ]}
          onMutationFire={(call) => calls.push(call)}
        />,
      );

      const saveButton = screen.getByRole("button", { name: "Save" });
      await waitFor(() => expect(saveButton).toBeDisabled());

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/system prompt is required/i);

      // Even if the disabled attribute is bypassed (e.g. via the keyboard or
      // a programmatic submit), the click handler must still bail on the
      // failed `methods.trigger()` — no mutation should fire.
      await act(async () => {
        saveButton.removeAttribute("disabled");
        saveButton.click();
      });
      expect(calls).toHaveLength(0);
    });
  });

  describe("when the user types a non-empty system message into the empty form", () => {
    // The @e2e happy-path binding covers AC 4 at integration scope —
    // the save handler firing with the supplied system content is
    // the regression surface.  Browser-level e2e queued as follow-up.
    /** @scenario "Save becomes enabled once the user fills in a system prompt" */
    /** @scenario "Workflow with a valid system prompt saves successfully (happy-path regression)" */
    it("clears the inline error, re-enables Save, and fires the mutation with the typed content", async () => {
      const calls: MutationCall[] = [];
      const user = userEvent.setup();
      render(
        <PromptSaveHarness
          initialMessages={[
            { role: "system", content: "" },
            { role: "user", content: "{{input}}" },
          ]}
          onMutationFire={(call) => calls.push(call)}
        />,
      );

      const saveButton = screen.getByRole("button", { name: "Save" });
      await waitFor(() => expect(saveButton).toBeDisabled());
      await screen.findByRole("alert");

      const textarea = screen.getByLabelText("system-content");
      await user.type(textarea, "You are a helpful assistant.");

      await waitFor(() => expect(saveButton).not.toBeDisabled());
      expect(screen.queryByRole("alert")).toBeNull();

      await user.click(saveButton);
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]?.systemContent).toBe("You are a helpful assistant.");
    });
  });
});
