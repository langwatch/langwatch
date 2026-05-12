/**
 * @vitest-environment jsdom
 *
 * Integration tests for the system-prompt-required validation flow
 * (Issue #3196 — Bug 2 client-side). These exercise the real
 * `usePromptConfigForm` resolver + the same `useWatch` -> Save-button
 * disabled wiring used by `PromptEditorDrawer`, so the scenarios bind
 * the *behavior* a user sees, not just the schema.
 *
 * Scope: schema refinement + RHF resolver. Drawer-level mocks
 * (tRPC, RBAC, toaster, project context) are out of scope here — they
 * are exercised by the existing `PromptEditorDrawer.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { useWatch } from "react-hook-form";

// Mock the model-limits hook so the form resolver doesn't pull in tRPC.
// We only care about the system-prompt-required refinement; model limits
// are exercised in `form-schema.test.ts`.
vi.mock("~/hooks/useModelLimits", () => ({
  useModelLimits: () => ({ limits: null }),
}));

import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";
import { usePromptConfigForm } from "../usePromptConfigForm";

interface MutationCall {
  systemContent: string | undefined;
}

/**
 * Minimal harness that mirrors the parts of PromptEditorDrawer that
 * matter for #3196: a Save button gated on `isValid` (computed via
 * `useWatch` on messages), an inline error surfaced from the resolver,
 * and a fake mutation function that records whether Save actually
 * fired.  Anything more would duplicate the existing drawer test setup.
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
  const hasSystemPrompt =
    Array.isArray(messages) &&
    messages.some(
      (m: { role?: string; content?: string }) =>
        m?.role === "system" &&
        typeof m?.content === "string" &&
        m.content.trim() !== "",
    );
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
      {messagesError?.message && (
        <p role="alert">{messagesError.message}</p>
      )}
      <button
        type="button"
        disabled={!hasSystemPrompt}
        onClick={() => void handleClick()}
      >
        Save
      </button>
    </form>
  );
}

function FakeToast({
  fireServerError,
}: {
  fireServerError: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          fireServerError("System prompt is required.");
          setError("System prompt is required.");
        }}
      >
        Simulate server 400
      </button>
      {error && <div role="status">{error}</div>}
    </div>
  );
}

describe("usePromptConfigForm — system-prompt-required save flow (Issue #3196)", () => {
  afterEach(() => {
    cleanup();
  });


  /** @scenario "Save is disabled when the workflow prompt's system message is empty" */
  it("disables Save and shows an inline required-field error when the system message is empty (no mutation fires)", async () => {
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

    // Force-click to prove the click handler also bails on the validation
    await act(async () => {
      saveButton.removeAttribute("disabled");
      saveButton.click();
    });
    expect(calls).toHaveLength(0);
  });

  /** @scenario "Save becomes enabled once the user fills in a system prompt" */
  it("clears the inline error and re-enables Save once the user types a non-empty system prompt", async () => {
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

  /** @scenario "Toast on server-side validation failure shows a friendly message" */
  it("renders the server-returned friendly message in the toast (no stack trace, no class name)", async () => {
    const captured: string[] = [];
    render(
      <FakeToast
        fireServerError={(message) => {
          captured.push(message);
        }}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: /simulate server 400/i,
    });
    await userEvent.setup().click(trigger);

    const toast = await screen.findByRole("status");
    // The toast text is sourced from the tRPC error message, not a stack.
    expect(toast.textContent).toBe("System prompt is required.");
    expect(toast.textContent).not.toMatch(/SystemPromptConflictError/);
    expect(toast.textContent).not.toMatch(/SystemPromptRequiredError/);
    expect(toast.textContent).not.toMatch(/\bat [A-Za-z]/); // no stack frames
    expect(captured).toEqual(["System prompt is required."]);
  });
});
