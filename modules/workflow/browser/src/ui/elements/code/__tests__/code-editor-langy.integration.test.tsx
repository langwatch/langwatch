/** @vitest-environment jsdom */
// Spec: specs/langy/langy-studio-code-blocks.feature
import { defineSlice } from "@langwatch/browser-host/global-store";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import {
  LANGY_REGISTRATIONS_SLICE,
  type LangyAskRequest,
  type LangyRegistrationsState,
  type LangyUiActionHandlers,
} from "@langwatch/langy-contract";
import { act, fireEvent, screen } from "@testing-library/react";
import { type ReactNode, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCodeEditorAssistant } from "../../../../behavior/use-code-editor-langy.ts";
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
const fakeMonaco = {
  editor: { onDidChangeMarkers: () => subscription },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyI: 39 },
};

/** Whether the stand-in diff reports itself rendered at once, or when a test finishes it. */
const diffRendering: { immediate: boolean; finish: (() => void) | null } = {
  immediate: true,
  finish: null,
};

// Monaco does not run in jsdom: the stand-in edits through a textarea and shows a diff as data.
vi.mock("@monaco-editor/react", () => ({
  default: ({
    defaultValue,
    onChange,
    onMount,
  }: {
    defaultValue: string;
    onChange: (value: string) => void;
    onMount: (editor: unknown, monaco: unknown) => void;
  }) => {
    const [mount] = useState(() => ({ done: false }));
    useEffect(() => {
      if (mount.done) return;
      mount.done = true;
      onMount(fakeEditor, fakeMonaco);
    }, [mount, onMount]);
    return (
      <textarea
        data-testid="monaco"
        defaultValue={defaultValue}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
  DiffEditor: ({
    original,
    modified,
    onMount,
  }: {
    original: string;
    modified: string;
    onMount: () => void;
  }) => {
    useEffect(() => {
      if (diffRendering.immediate) onMount();
      else diffRendering.finish = onMount;
    }, [onMount]);
    return <div data-testid="monaco-diff" data-original={original} data-modified={modified} />;
  },
}));
vi.mock("monacopilot", () => ({ registerCompletion: vi.fn() }));
vi.mock("../../../../model/code/python-providers.ts", () => ({
  registerPythonProviders: vi.fn(() => ({ dispose: vi.fn(), setContract: vi.fn() })),
}));

const SAVED_CODE = "class Code:\n    def __call__(self, question: str):\n        return {}";
const PROPOSED_CODE =
  "class Code:\n    def __call__(self, question: str):\n        return {'answer': question.upper()}";

/** Stands in for Langy's panel, the slice's owner: it remembers what the editor registered. */
const langy: { handlers: LangyUiActionHandlers | null; withdrawals: number; heldAbove: number } = {
  handlers: null,
  withdrawals: 0,
  heldAbove: 0,
};

beforeEach(() => {
  diffRendering.immediate = true;
  diffRendering.finish = null;
  langy.handlers = null;
  langy.withdrawals = 0;
  langy.heldAbove = 0;
  defineSlice<LangyRegistrationsState>({
    name: LANGY_REGISTRATIONS_SLICE,
    create: () => ({
      registerHandlers: () => undefined,
      clearHandlers: () => undefined,
      registerActions: (handlers) => {
        langy.handlers = handlers;
      },
      clearActions: () => {
        langy.handlers = null;
        langy.withdrawals += 1;
      },
      holdAbove: () => {
        langy.heldAbove += 1;
        return () => {
          langy.heldAbove -= 1;
        };
      },
    }),
  });
});

afterEach(() => vi.clearAllMocks());

const renderModal = ({ children }: { children: ReactNode }) => <div>{children}</div>;

function Harness({
  open,
  ask,
  setCode,
  onClose,
  nodeId = "code_1",
}: {
  nodeId?: string;
  open: boolean;
  ask: ((request: LangyAskRequest) => void) | undefined;
  setCode: (code: string) => void;
  onClose: () => void;
}) {
  const assistant = useCodeEditorAssistant({
    subject: { nodeId, nodeName: "Shout", lastError: "NameError: name 'x'" },
    open,
    language: "python",
    savedCode: SAVED_CODE,
    inputs: [{ identifier: "question", type: "str" }],
    outputs: [{ identifier: "answer", type: "str" }],
    secretNames: ["OPENAI_KEY"],
    ask,
    mayPropose: true,
  });
  return (
    <WorkflowCodeEditorModal
      code={SAVED_CODE}
      setCode={setCode}
      open={open}
      onClose={onClose}
      language="python"
      inputs={[{ identifier: "question", type: "str" }]}
      outputs={[{ identifier: "answer", type: "str" }]}
      secretNames={["OPENAI_KEY"]}
      renderModal={renderModal}
      assistant={assistant}
    />
  );
}

function openEditor({ available = true }: { available?: boolean } = {}) {
  const ask = vi.fn<(request: LangyAskRequest) => void>();
  const setCode = vi.fn<(code: string) => void>();
  const onClose = vi.fn();
  const view = renderWithDesignSystem(
    <Harness open ask={available ? ask : undefined} setCode={setCode} onClose={onClose} />,
  );
  const rerender = (open: boolean, nodeId?: string) =>
    view.rerender(
      <Harness
        nodeId={nodeId}
        open={open}
        ask={available ? ask : undefined}
        setCode={setCode}
        onClose={onClose}
      />,
    );
  return { ask, setCode, onClose, rerender };
}

function handler(kind: string) {
  const found = langy.handlers?.[kind];
  if (!found) throw new Error(`the editor registered no ${kind}`);
  return found;
}

/** The read token Langy got back from reading the open code block. */
async function read(): Promise<string> {
  const answer = (await handler("studio.code.read").run({} as never)) as { readToken: string };
  return answer.readToken;
}

/** Proposes as Langy does: against a fresh read unless handed an older one. */
async function propose(code = PROPOSED_CODE, readToken?: string) {
  const token = readToken ?? (await read());
  await act(async () => {
    await handler("studio.code.propose").run({
      code,
      summary: "Upper-cases the answer",
      readToken: token,
    } as never);
  });
}

describe("the Studio code editor with Langy", () => {
  describe("when the user asks Langy from the header", () => {
    /** @scenario "Asking Langy from the editor hands over the code block" */
    it("asks with the language, the buffer, the fields, the secret names and the last error", async () => {
      const { ask } = openEditor();

      fireEvent.click(await screen.findByRole("button", { name: /Ask Langy/ }));
      const prompt = screen.getByRole("textbox", { name: "Describe what this code should do" });
      fireEvent.change(prompt, { target: { value: "Return the question in upper case" } });
      fireEvent.keyDown(prompt, { key: "Enter" });

      expect(ask).toHaveBeenCalledOnce();
      const request = ask.mock.calls[0]?.[0];
      expect(request?.question).toContain("Return the question in upper case");
      expect(request?.question).toContain("Python code block");
      expect(request?.question).toContain("def __call__(self, question: str)");
      const ref = request?.context?.[0]?.ref ?? "";
      expect(request?.context?.[0]?.kind).toBe("workflow");
      expect(ref).toContain("inputs: question: str");
      expect(ref).toContain("outputs: answer: str");
      expect(ref).toContain("OPENAI_KEY");
      expect(ref).toContain("NameError");
      expect(screen.queryByTestId("code-ask-prompt")).toBeNull();
    });
  });

  describe("when the user presses Cmd+I", () => {
    /** @scenario "Cmd+I opens the inline prompt at the editor" */
    it("opens the inline prompt, and Escape closes it without asking", async () => {
      const { ask } = openEditor();
      await screen.findByTestId("monaco");

      fireEvent.keyDown(window, { key: "i", metaKey: true });
      const prompt = await screen.findByPlaceholderText("Describe what this code should do");
      fireEvent.keyDown(prompt, { key: "Escape" });

      expect(screen.queryByTestId("code-ask-prompt")).toBeNull();
      expect(ask).not.toHaveBeenCalled();
    });
  });

  describe("when Langy is unavailable for the project", () => {
    /** @scenario "The editor shows no Langy control when Langy is unavailable" */
    it("shows no Ask Langy control, opens no prompt and registers nothing", async () => {
      openEditor({ available: false });
      await screen.findByTestId("monaco");

      fireEvent.keyDown(window, { key: "i", metaKey: true });

      expect(screen.queryByRole("button", { name: /Ask Langy/ })).toBeNull();
      expect(screen.queryByTestId("code-ask-prompt")).toBeNull();
      expect(langy.handlers).toBeNull();
    });
  });

  describe("when the editor is open", () => {
    /** @scenario "The open code editor registers its actions with Langy while it is open" */
    it("registers exactly read and propose, and withdraws them when it closes", async () => {
      const { rerender } = openEditor();
      await screen.findByTestId("monaco");

      expect(Object.keys(langy.handlers ?? {}).toSorted()).toEqual([
        "studio.code.propose",
        "studio.code.read",
      ]);

      rerender(false);

      expect(langy.handlers).toBeNull();
      expect(langy.withdrawals).toBe(1);
    });

    /** @scenario "studio.code.read answers the code block as the editor holds it" */
    it("answers the unsaved buffer, the fields, the secret names and the last error", async () => {
      openEditor();
      fireEvent.change(await screen.findByTestId("monaco"), {
        target: { value: "class Code: # edited" },
      });

      const answer = await handler("studio.code.read").run({} as never);

      expect(answer).toEqual({
        readToken: expect.any(String),
        nodeId: "code_1",
        nodeName: "Shout",
        language: "python",
        code: "class Code: # edited",
        codeTooLarge: false,
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
        secretNames: ["OPENAI_KEY"],
        lastError: "NameError: name 'x'",
        hasUnsavedChanges: true,
      });
    });
  });

  describe("when Langy proposes new code", () => {
    /** @scenario "studio.code.propose shows the proposal as a diff with Accept and Reject" */
    it("shows the summary and a diff of the buffer against the proposal", async () => {
      openEditor();
      await screen.findByTestId("monaco");

      await propose();

      expect(screen.getByText("Upper-cases the answer")).toBeTruthy();
      const diff = await screen.findByTestId("monaco-diff");
      expect(diff.dataset.original).toBe(SAVED_CODE);
      expect(diff.dataset.modified).toBe(PROPOSED_CODE);
      expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    });

    /** @scenario "Accepting a proposal replaces the unsaved buffer only" */
    it("puts the proposal in the buffer on Accept and saves only when the user saves", async () => {
      const { setCode } = openEditor();
      await screen.findByTestId("monaco");
      await propose();

      fireEvent.click(screen.getByRole("button", { name: "Accept" }));

      expect((await screen.findByTestId<HTMLTextAreaElement>("monaco")).value).toBe(PROPOSED_CODE);
      expect(setCode).not.toHaveBeenCalled();

      fireEvent.keyDown(window, { key: "s", metaKey: true });

      expect(setCode).toHaveBeenCalledWith(PROPOSED_CODE);
    });

    /** @scenario "Rejecting a proposal discards it" */
    it("keeps the buffer it held and saves nothing on Reject", async () => {
      const { setCode } = openEditor();
      await screen.findByTestId("monaco");
      await propose();

      fireEvent.click(screen.getByRole("button", { name: "Reject" }));

      expect((await screen.findByTestId<HTMLTextAreaElement>("monaco")).value).toBe(SAVED_CODE);
      expect(screen.queryByTestId("monaco-diff")).toBeNull();
      expect(setCode).not.toHaveBeenCalled();
    });

    /** @scenario "A proposal never saves the workflow or runs the node" */
    it("neither saves, closes nor runs, and offers no other action", async () => {
      const { setCode, onClose } = openEditor();
      await screen.findByTestId("monaco");

      await propose();
      fireEvent.click(screen.getByRole("button", { name: "Accept" }));

      expect(setCode).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(Object.keys(langy.handlers ?? {}).toSorted()).toEqual([
        "studio.code.propose",
        "studio.code.read",
      ]);
    });

    /** @scenario "Accept waits until the diff is on screen" */
    it("keeps Accept disabled until the diff has rendered", async () => {
      diffRendering.immediate = false;
      openEditor();
      await screen.findByTestId("monaco");
      await propose();

      const accept = screen.getByRole<HTMLButtonElement>("button", { name: "Accept" });
      expect(accept.disabled).toBe(true);

      act(() => diffRendering.finish?.());

      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Accept" }).disabled).toBe(
        false,
      );
    });

    /** @scenario "A proposal belongs to the code block it was made for" */
    it("drops the proposal when the editor switches to another code block", async () => {
      const { rerender, setCode } = openEditor();
      await screen.findByTestId("monaco");
      await propose();
      expect(screen.getByTestId("monaco-diff")).toBeTruthy();

      rerender(true, "code_2");

      expect(screen.queryByTestId("monaco-diff")).toBeNull();
      expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
      expect((await screen.findByTestId<HTMLTextAreaElement>("monaco")).value).toBe(SAVED_CODE);
      expect(setCode).not.toHaveBeenCalled();
    });

    /** @scenario "A proposal is refused once the editor moved to another code block" */
    it("refuses code written for the code block the editor has left", async () => {
      const { rerender } = openEditor();
      await screen.findByTestId("monaco");
      const readOfFirst = await read();

      rerender(true, "code_2");
      await screen.findByTestId("monaco");

      await expect(propose(PROPOSED_CODE, readOfFirst)).rejects.toMatchObject({
        code: "studio_code_target_changed",
      });
      await expect(propose(PROPOSED_CODE, "made-up")).rejects.toMatchObject({
        code: "studio_code_target_changed",
      });
      expect(screen.queryByTestId("monaco-diff")).toBeNull();
    });

    /** @scenario "A second proposal is refused while one awaits review" */
    it("refuses another proposal until the first is accepted or rejected", async () => {
      openEditor();
      await screen.findByTestId("monaco");
      await propose();

      await expect(propose("print('other')")).rejects.toMatchObject({
        code: "studio_code_proposal_pending",
      });
      expect(screen.getByTestId("monaco-diff").dataset.modified).toBe(PROPOSED_CODE);

      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      await propose("print('other')");
      expect(screen.getByTestId("monaco-diff").dataset.modified).toBe("print('other')");
    });
  });

  describe("when the editor opens over Studio's node drawer", () => {
    /** @scenario "Langy rides above Studio's node drawer while the code editor is open" */
    it("holds Langy above while open and releases it on close", async () => {
      const { rerender } = openEditor();
      await screen.findByTestId("monaco");
      expect(langy.heldAbove).toBe(1);

      rerender(false);

      expect(langy.heldAbove).toBe(0);
    });

    it("does not hold Langy where Langy is unavailable", async () => {
      openEditor({ available: false });
      await screen.findByTestId("monaco");
      expect(langy.heldAbove).toBe(0);
    });
  });
});
