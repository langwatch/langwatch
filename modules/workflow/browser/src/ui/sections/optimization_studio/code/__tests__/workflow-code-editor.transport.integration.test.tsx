/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, fireEvent, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowCodeEditorModalHost } from "../workflow-code-editor.transport.tsx";

// An explicit return type: a function whose body only throws infers `never`,
// and TypeScript refuses a `never`-returning function as a JSX component.
function BrokenEditor(): ReactElement {
  throw new Error("editor failed to render");
}

describe("WorkflowCodeEditorModalHost", () => {
  afterEach(() => vi.restoreAllMocks());

  it("contains an editor render failure without closing the modal", () => {
    vi.spyOn(console, "error").mockImplementation(() => void 0);

    renderWithDesignSystem(
      <WorkflowCodeEditorModalHost open onRequestClose={vi.fn()} besideLangy={false}>
        <BrokenEditor />
      </WorkflowCodeEditorModalHost>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  describe("when Langy is on offer", () => {
    /** @scenario "The code editor leaves Langy's dock in view and usable" */
    it("lets the reader type into Langy's composer without closing the editor", async () => {
      const onRequestClose = vi.fn();
      renderWithDesignSystem(
        <>
          <textarea aria-label="Langy composer" />
          <WorkflowCodeEditorModalHost open onRequestClose={onRequestClose} besideLangy>
            <button type="button">Inside the editor</button>
          </WorkflowCodeEditorModalHost>
        </>,
      );
      await screen.findByRole("button", { name: "Inside the editor" });

      const composer = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Langy composer" });
      fireEvent.pointerDown(composer);
      act(() => composer.focus());
      fireEvent.change(composer, { target: { value: "make it shout" } });

      expect(document.activeElement).toBe(composer);
      expect(composer.value).toBe("make it shout");
      expect(onRequestClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Inside the editor" })).toBeTruthy();
    });
  });
});
