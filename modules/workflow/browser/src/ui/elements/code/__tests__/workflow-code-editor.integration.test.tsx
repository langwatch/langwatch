/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen } from "@testing-library/react";
import { type ReactNode, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerJavaScriptLanguageService } from "../../../../model/code/javascript-language-service.ts";
import { registerPythonProviders } from "../../../../model/code/python-providers.ts";
import { WorkflowCodeEditorModal } from "../workflow-code-editor.tsx";

const subscription = { dispose: () => undefined };
const fakeEditor = {
  focus: () => undefined,
  getDomNode: () => null,
  onDidDispose: () => subscription,
  onKeyDown: () => subscription,
  hasTextFocus: () => true,
  getPosition: () => null,
  getSelection: () => null,
  getModel: () => null,
  onDidChangeCursorPosition: () => subscription,
  onDidChangeCursorSelection: () => subscription,
};
const fakeMonaco = { editor: { onDidChangeMarkers: () => subscription } };

// Monaco itself does not run in jsdom; the stub reports the mode it was opened in.
vi.mock("@monaco-editor/react", () => ({
  default: ({
    defaultLanguage,
    onMount,
  }: {
    defaultLanguage: string;
    onMount: (editor: unknown, monaco: unknown) => void;
  }) => {
    const [mount] = useState(() => ({ done: false }));
    useEffect(() => {
      if (mount.done) return;
      mount.done = true;
      onMount(fakeEditor, fakeMonaco);
    }, [mount, onMount]);
    return <div data-testid="monaco" data-language={defaultLanguage} />;
  },
}));
vi.mock("monacopilot", () => ({ registerCompletion: vi.fn() }));
vi.mock("../../../../model/code/javascript-language-service.ts", () => ({
  registerJavaScriptLanguageService: vi.fn(() => ({ dispose: vi.fn(), setContract: vi.fn() })),
}));
vi.mock("../../../../model/code/python-providers.ts", () => ({
  registerPythonProviders: vi.fn(() => ({ dispose: vi.fn(), setContract: vi.fn() })),
}));

const renderModal = ({ children }: { children: ReactNode }) => <div>{children}</div>;

function openEditor({ language }: { language?: string }) {
  renderWithDesignSystem(
    <WorkflowCodeEditorModal
      code="source"
      setCode={vi.fn()}
      open
      onClose={vi.fn()}
      language={language}
      secretNames={["TOKEN"]}
      renderModal={renderModal}
    />,
  );
}

describe("WorkflowCodeEditorModal", () => {
  afterEach(() => vi.clearAllMocks());

  describe("given a JavaScript code node", () => {
    it("edits code.mjs with the JavaScript service, not the Python providers", async () => {
      openEditor({ language: "javascript" });

      expect((await screen.findByTestId("monaco")).dataset.language).toBe("javascript");
      expect(screen.getByText("code.mjs")).toBeTruthy();
      expect(screen.getByText("JavaScript")).toBeTruthy();
      expect(screen.getByText("Spaces: 2")).toBeTruthy();
      expect(registerPythonProviders).not.toHaveBeenCalled();
      expect(registerJavaScriptLanguageService).toHaveBeenCalledWith(
        expect.objectContaining({ contract: expect.objectContaining({ secretNames: ["TOKEN"] }) }),
      );
    });
  });

  describe("given a code node without a language", () => {
    it("edits Code.py in Python mode with the Python providers", async () => {
      openEditor({});

      expect((await screen.findByTestId("monaco")).dataset.language).toBe("python");
      expect(screen.getByText("Code.py")).toBeTruthy();
      expect(screen.getByText("Python")).toBeTruthy();
      expect(registerPythonProviders).toHaveBeenCalledOnce();
      expect(registerJavaScriptLanguageService).not.toHaveBeenCalled();
    });
  });
});
