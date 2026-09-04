/**
 * @vitest-environment jsdom
 *
 * Integration tests for the system-prompt-required validation flow
 * (Issue #3196 — Bug 2 client-side). These exercise the real
 * `usePromptConfigForm` resolver + the same `useWatch`-driven Save-button
 * disabled wiring used by `PromptEditorDrawer`, so the scenarios bind the
 * behavior a user sees, not just the schema.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { useWatch } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/model-provider-web/hooks/useModelLimits", () => ({
  useModelLimits: () => ({ limits: null }),
}));

import { hasNonEmptySystemMessage } from "@langwatch/prompt-web/surfaces/prompt-form";
import { usePromptConfigForm } from "../use-prompt-config-form";

interface MutationCall {
  systemContent: string | undefined;
}

function PromptSaveHarness({
  initialMessages,
  onMutationFire,
}: {
  initialMessages: Array<{ role: "system" | "user"; content: string }>;
  onMutationFire: (call: MutationCall) => void;
}) {
  const { methods } = usePromptConfigForm({
    initialConfigValues: { version: { configData: { messages: initialMessages } } },
  });
  useEffect(() => {
    void methods.trigger();
  }, [methods]);
  const messages = useWatch({
    control: methods.control,
    name: "version.configData.messages",
  });
  const isValid = hasNonEmptySystemMessage(messages);
  const messagesError = methods.formState.errors.version?.configData?.messages as
    | { message?: string }
    | undefined;

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
          const next = [...(messages ?? [])].map((m) =>
            m.role === "system" ? { ...m, content: e.target.value } : m,
          );
          methods.setValue("version.configData.messages", next, {
            shouldValidate: true,
            shouldDirty: true,
          });
        }}
      />
      {messagesError?.message && <p role="alert">{messagesError.message}</p>}
      <button type="button" disabled={!isValid} onClick={() => void handleClick()}>
        Save
      </button>
    </form>
  );
}

describe("usePromptConfigForm — system-prompt-required save flow (Issue #3196)", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a form rendered with an empty system message", () => {
    describe("when the system message is empty on initial render", () => {
      /** @scenario Save is disabled when the workflow prompt's system message is empty */
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

        await act(async () => {
          saveButton.removeAttribute("disabled");
          saveButton.click();
        });
        expect(calls).toHaveLength(0);
      });
    });

    describe("when the user types a non-empty system message into the empty form", () => {
      /** @scenario Save becomes enabled once the user fills in a system prompt */
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
});
