/**
 * @vitest-environment jsdom
 * @see modules/analytics/specs/analytics-lwql-editor.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEditorValueSync } from "../use-editor-value-sync.ts";

function fakeEditor({ text, focused }: { text: string; focused: boolean }) {
  return { hasTextFocus: () => focused, getValue: () => text, setValue: vi.fn() };
}

describe("useEditorValueSync", () => {
  describe("given the member is typing ahead of the host", () => {
    /** @scenario "Typing ahead of the host keeps the text, the cursor and the completion list" */
    it("never writes the host's older text over the editor", () => {
      const editor = fakeEditor({ text: "LW.", focused: true });
      renderHook(() => useEditorValueSync({ editor, value: "L" }));
      expect(editor.setValue).not.toHaveBeenCalled();
    });
  });

  describe("given the host changes the value while the editor is not focused", () => {
    /** @scenario "Typing ahead of the host keeps the text, the cursor and the completion list" */
    it("shows the host's value", () => {
      const editor = fakeEditor({ text: "old", focused: false });
      renderHook(() => useEditorValueSync({ editor, value: "starter" }));
      expect(editor.setValue).toHaveBeenCalledWith("starter");
    });
  });
});
