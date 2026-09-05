/**
 * @vitest-environment jsdom
 * @see specs/prompts/prompt-editor-dirty-state.feature
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
 * A prompt as the seeder writes one: a system prompt, one input, one output, and no
 * demonstrations.
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
        const next = messages.map((m) =>
          m.role === "system" ? { ...m, content: e.target.value } : m,
        );
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
