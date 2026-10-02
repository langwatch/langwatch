/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen } from "@testing-library/react";
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
      <WorkflowCodeEditorModalHost open onRequestClose={vi.fn()}>
        <BrokenEditor />
      </WorkflowCodeEditorModalHost>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
