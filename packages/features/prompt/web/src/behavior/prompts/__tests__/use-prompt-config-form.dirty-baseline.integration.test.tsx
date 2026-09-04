/**
 * @vitest-environment jsdom
 *
 * @see specs/prompts/prompt-editor-dirty-state.feature
 *
 * Opening a seeded prompt and touching nothing must not report a modified
 * prompt. The dirty flag is what tells a reader whether their work is safe,
 * and a form that claims changes on an untouched prompt teaches people to
 * dismiss the warning, which is exactly when it stops protecting anything.
 *
 * This exercises the real `usePromptConfigForm` and the real
 * `versionedPromptToPromptConfigFormValuesWithSystemMessage` converter,
 * driven the way `PromptEditorDrawer`'s own init effect drives them: mount
 * with no initial values (the form settles on generic defaults first, the
 * way it does before the server prompt arrives), then `methods.reset(...)`
 * with the converted server values once they "arrive" — because the defect
 * this guards against lived in what the converter's derived shape and the
 * form's own defaults do to each other, not in either alone.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VersionedPrompt } from "@langwatch/prompt-contract";

vi.mock("@langwatch/model-provider-web/hooks/useModelLimits", () => ({
  useModelLimits: () => ({ limits: null }),
}));

import { versionedPromptToPromptConfigFormValuesWithSystemMessage } from "../../../model/prompt-form/versioned-prompt-form-values";
import { usePromptConfigForm } from "../use-prompt-config-form";

/**
 * A prompt as the seeder writes one: a system prompt, one input, one
 * output, and no demonstrations. The form derives demonstration columns
 * from the inputs and outputs, which is the derived value the stored
 * document never carries — exactly the shape the original defect tripped
 * on.
 */
const SEEDED_PROMPT: VersionedPrompt = {
  id: "prompt-seeded",
  name: "Seeded Prompt",
  handle: "seeded-prompt",
  scope: "PROJECT",
  version: 1,
  versionId: "version-seeded",
  versionCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
  model: "openai/gpt-4o",
  temperature: 0.7,
  maxTokens: 4096,
  prompt: "You are a helpful assistant.",
  projectId: "test-project-id",
  organizationId: "test-org-id",
  messages: [],
  authorId: null,
  inputs: [{ identifier: "question", type: "str" }],
  outputs: [{ identifier: "answer", type: "str" }],
  demonstrations: { inline: { records: {}, columnTypes: [] } },
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  tags: [],
  parameters: {},
};

function DirtyBaselineHarness({ onIsDirty }: { onIsDirty: (isDirty: boolean) => void }) {
  const { methods } = usePromptConfigForm({});

  useEffect(() => {
    const serverValues = versionedPromptToPromptConfigFormValuesWithSystemMessage(SEEDED_PROMPT);
    methods.reset(serverValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onIsDirty(methods.formState.isDirty);
  }, [methods.formState.isDirty, onIsDirty]);

  const systemMessage =
    methods.watch("version.configData.messages")?.find((m) => m.role === "system")?.content ?? "";

  return (
    <textarea
      aria-label="system-content"
      value={systemMessage}
      onChange={(e) => {
        const messages = methods.getValues("version.configData.messages") ?? [];
        const next = messages.map((m) => (m.role === "system" ? { ...m, content: e.target.value } : m));
        methods.setValue("version.configData.messages", next, { shouldDirty: true });
      }}
    />
  );
}

describe("usePromptConfigForm — dirty baseline after loading a seeded prompt", () => {
  afterEach(() => cleanup());

  describe("given a seeded prompt reset into the form the way the drawer's init effect does", () => {
    /** @scenario "An untouched prompt is not reported as modified" */
    it("settles isDirty to false, not true", async () => {
      const isDirtyCalls: boolean[] = [];
      render(<DirtyBaselineHarness onIsDirty={(v) => isDirtyCalls.push(v)} />);

      await waitFor(() => {
        expect(isDirtyCalls[isDirtyCalls.length - 1]).toBe(false);
      });
    });

    /** @scenario "Closing an untouched prompt warns about nothing" */
    it("never reports dirty at any point during settling", async () => {
      const isDirtyCalls: boolean[] = [];
      render(<DirtyBaselineHarness onIsDirty={(v) => isDirtyCalls.push(v)} />);

      await waitFor(() => {
        expect(isDirtyCalls[isDirtyCalls.length - 1]).toBe(false);
      });

      expect(isDirtyCalls.every((v) => v === false)).toBe(true);
    });
  });

  describe("given one character typed into the prompt", () => {
    /** @scenario "A real edit is still reported as modified" */
    it("reports the prompt as modified", async () => {
      const isDirtyCalls: boolean[] = [];
      render(<DirtyBaselineHarness onIsDirty={(v) => isDirtyCalls.push(v)} />);

      await waitFor(() => {
        expect(isDirtyCalls[isDirtyCalls.length - 1]).toBe(false);
      });

      const textarea = screen.getByLabelText("system-content") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: `${textarea.value}!` } });

      await waitFor(() => {
        expect(isDirtyCalls[isDirtyCalls.length - 1]).toBe(true);
      });
    });
  });
});
