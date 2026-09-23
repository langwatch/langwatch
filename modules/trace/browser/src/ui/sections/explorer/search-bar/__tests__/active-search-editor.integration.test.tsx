/**
 * DOM-level integration tests for the SearchBar editor's rendered output.
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ActiveSearchEditor } from "../active-search-editor.tsx";

afterEach(cleanup);

function renderEditor(queryText: string) {
  const applyQueryText = vi.fn();
  const submitQueryText = vi.fn();
  const utils = render(
    <ChakraProvider value={defaultSystem}>
      <ActiveSearchEditor
        queryText={queryText}
        applyQueryText={applyQueryText}
        submitQueryText={submitQueryText}
        autoFocus={false}
        onHasContentChange={() => {
          /* no-op */
        }}
      />
    </ChakraProvider>,
  );
  return { ...utils, applyQueryText, submitQueryText };
}

async function waitForEditor(): Promise<HTMLElement> {
  return waitFor(() => {
    const editor = document.querySelector(".tiptap") as HTMLElement | null;
    expect(editor).toBeInTheDocument();
    return editor as HTMLElement;
  });
}

/** Replaces a prototype method for the duration of a test; jsdom has no layout to measure. */
function stubMethod(target: object, name: string, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
  return () => {
    if (original) Object.defineProperty(target, name, original);
  };
}

/** A zero-height box at `left`, the only geometry the anchor reads. */
function rectAt(left: number) {
  return {
    top: 0,
    bottom: 16,
    left,
    right: left,
    width: 0,
    height: 16,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

describe("ActiveSearchEditor keys", () => {
  describe("given free text with the dropdown closed", () => {
    /** @scenario "Enter on free text submits" */
    it("submits on Enter and applies nothing on its own", async () => {
      const { applyQueryText, submitQueryText } = renderEditor("annoyed users");
      const editor = await waitForEditor();

      fireEvent.keyDown(editor, { key: "Enter" });

      expect(submitQueryText).toHaveBeenCalledTimes(1);
      expect(submitQueryText).toHaveBeenCalledWith("annoyed users");
      expect(applyQueryText).not.toHaveBeenCalled();
    });

    /** @scenario "Cmd+Enter is plain Enter" */
    it("treats a held modifier as plain Enter: there is no second path out of the bar", async () => {
      const { applyQueryText, submitQueryText } = renderEditor("annoyed users");
      const editor = await waitForEditor();

      fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
      fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

      expect(submitQueryText).toHaveBeenCalledTimes(2);
      expect(submitQueryText).toHaveBeenLastCalledWith("annoyed users");
      expect(applyQueryText).not.toHaveBeenCalled();
    });
  });

  describe("given text the user has not submitted", () => {
    /** @scenario "Leaving the search bar keeps the text without searching" */
    it("blurs without submitting or applying", async () => {
      const { applyQueryText, submitQueryText } = renderEditor("annoyed users");
      const editor = await waitForEditor();

      fireEvent.focus(editor);
      fireEvent.blur(editor);
      fireEvent.keyDown(editor, { key: "Escape" });

      expect(submitQueryText).not.toHaveBeenCalled();
      expect(applyQueryText).not.toHaveBeenCalled();
      expect(editor.textContent).toContain("annoyed users");
    });
  });
});

describe("ActiveSearchEditor applied query", () => {
  // A focused editor scrolls its selection into view, which reads Range geometry jsdom lacks.
  beforeAll(() => {
    stubMethod(Range.prototype, "getClientRects", () => []);
    stubMethod(Range.prototype, "getBoundingClientRect", () => rectAt(0));
  });

  function editorWith(queryText: string) {
    const submitQueryText = vi.fn();
    const onCursorAnchorChange = vi.fn();
    const ui = (text: string, clearNonce = 0) => (
      <ChakraProvider value={defaultSystem}>
        <ActiveSearchEditor
          queryText={text}
          applyQueryText={vi.fn()}
          submitQueryText={submitQueryText}
          autoFocus={false}
          onHasContentChange={() => {
            /* no-op */
          }}
          onCursorAnchorChange={onCursorAnchorChange}
          clearNonce={clearNonce}
        />
      </ChakraProvider>
    );
    const utils = render(ui(queryText));
    return { ...utils, ui, submitQueryText, onCursorAnchorChange };
  }

  describe("given a focused bar whose sentence was submitted with Enter", () => {
    describe("when the query the router produced is applied", () => {
      /** @scenario "The routed query replaces the sentence in the bar while the bar keeps focus" */
      it("shows the applied query as chips", async () => {
        const { rerender, ui } = editorWith("annoyed users");
        const editor = await waitForEditor();
        editor.focus();
        fireEvent.focus(editor);
        fireEvent.keyDown(editor, { key: "Enter" });

        rerender(ui("status:error AND service:checkout"));

        await waitFor(() => {
          expect(editor.textContent).toContain("status:error");
        });
        expect(editor.querySelectorAll(".filter-token").length).toBe(2);
      });

      /** @scenario "The routed query replaces the sentence in the bar while the bar keeps focus" */
      it("moves the Enter hint to the end of the applied query", async () => {
        // Eight pixels a character, measured over whatever the bar holds when it is measured.
        const CHARACTER_PX = 8;
        const widthOfBar = () =>
          (document
            .querySelector(".ProseMirror")
            ?.textContent?.replace(/\u00A0/g, " ")
            .trimEnd().length ?? 0) * CHARACTER_PX;
        const insideEditor = (element: Element) =>
          !element.classList.contains("ProseMirror") && element.closest(".ProseMirror") !== null;
        const restores = [
          stubMethod(Range.prototype, "getClientRects", () => [rectAt(widthOfBar())]),
          stubMethod(Range.prototype, "getBoundingClientRect", () => rectAt(widthOfBar())),
          stubMethod(Element.prototype, "getBoundingClientRect", function (this: Element) {
            return rectAt(insideEditor(this) ? widthOfBar() : 0);
          }),
          stubMethod(Element.prototype, "getClientRects", function (this: Element) {
            return [rectAt(insideEditor(this) ? widthOfBar() : 0)];
          }),
        ];
        try {
          const applied = "status:error AND service:checkout";
          const { rerender, ui, onCursorAnchorChange } = editorWith("annoyed users");
          const editor = await waitForEditor();
          editor.focus();
          fireEvent.focus(editor);
          fireEvent.keyDown(editor, { key: "Enter" });

          rerender(ui(applied));

          await waitFor(() => {
            expect(onCursorAnchorChange).toHaveBeenLastCalledWith(applied.length * CHARACTER_PX);
          });
        } finally {
          for (const restore of restores.reverse()) restore();
        }
      });
    });
  });

  describe("given a focused bar the user has not submitted", () => {
    describe("when the applied query changes", () => {
      it("keeps what the user is typing", async () => {
        const { rerender, ui } = editorWith("annoyed users");
        const editor = await waitForEditor();
        editor.focus();
        fireEvent.focus(editor);

        rerender(ui("status:error"));

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(editor.textContent).toContain("annoyed users");
        expect(editor.textContent).not.toContain("status:error");
      });
    });

    // Clear runs on mousedown and keeps the caret in the bar, and text never submitted is not
    // in the store to empty, so Clear reaches the document itself.
    describe("when the user clicks Clear", () => {
      /** @scenario "Clear empties the bar even while the bar has focus" */
      it("empties the bar", async () => {
        const { rerender, ui } = editorWith("annoyed users");
        const editor = await waitForEditor();
        await waitFor(() => expect(editor.textContent).toContain("annoyed users"));
        editor.focus();
        fireEvent.focus(editor);

        rerender(ui("", 1));

        await waitFor(() => expect(editor.textContent).toBe(""));
      });
    });
  });
});

describe("ActiveSearchEditor rendered DOM", () => {
  describe("given a single wildcard query", () => {
    it("renders one filter-token span containing the full field:value run", async () => {
      renderEditor("model:gpt-*");
      const editor = await waitForEditor();

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.textContent).toBe("model:gpt-*");

      // One delete widget per parsed tag.
      const deletes = editor.querySelectorAll("[data-filter-delete]");
      expect(deletes).toHaveLength(1);
      expect(deletes[0]?.getAttribute("data-field")).toBe("model");
      expect(deletes[0]?.getAttribute("data-value")).toBe("gpt-*");
    });
  });

  describe("given two tags joined by AND", () => {
    it("renders separate token spans plus a filter-keyword-and span between them", async () => {
      renderEditor("model:gpt-* AND status:error");
      const editor = await waitForEditor();

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.textContent).toBe("model:gpt-*");
      expect(tokens[1]?.textContent).toBe("status:error");

      const andKeyword = editor.querySelector(".filter-keyword-and");
      expect(andKeyword).toBeInTheDocument();
      expect(andKeyword?.textContent).toBe("AND");

      // Two delete widgets — one per tag.
      expect(editor.querySelectorAll("[data-filter-delete]")).toHaveLength(2);
    });
  });

  describe("given two tags joined by OR", () => {
    it("renders the OR keyword as its own decoration", async () => {
      renderEditor("model:gpt-* OR model:claude-*");
      const editor = await waitForEditor();

      const orKeyword = editor.querySelector(".filter-keyword-or");
      expect(orKeyword).toBeInTheDocument();
      expect(orKeyword?.textContent).toBe("OR");

      expect(editor.querySelectorAll(".filter-token")).toHaveLength(2);
    });
  });

  describe("given a value glued to AND with no space (regression case)", () => {
    it("renders the whole run as one merged token — liqe accepts `AND` inside an unquoted value, so a missing space silently fuses the clauses", async () => {
      // Liqe parses `model:gpt-*AND` as a single Tag whose value is the
      // literal string `gpt-*AND`. There's no AND keyword decoration because
      // the parser never saw a boolean operator. This is the failure mode
      // the user reported — a missing space corrupts the entire query.
      renderEditor("model:gpt-*AND");
      const editor = await waitForEditor();

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.textContent).toBe("model:gpt-*AND");

      // No AND keyword decoration — there's no boolean operator in the AST.
      expect(editor.querySelector(".filter-keyword-and")).toBeNull();

      // The single tag still gets a widget — it's a valid (if accidentally
      // glued) tag from the parser's perspective.
      const deleteWidget = editor.querySelector("[data-filter-delete]");
      expect(deleteWidget?.getAttribute("data-value")).toBe("gpt-*AND");
    });
  });

  describe("given a NOT-prefixed tag", () => {
    it("renders the negation keyword and the excluded token separately", async () => {
      renderEditor("NOT status:error");
      const editor = await waitForEditor();

      const notKeyword = editor.querySelector(".filter-keyword-not");
      expect(notKeyword).toBeInTheDocument();
      expect(notKeyword?.textContent).toBe("NOT");

      const excludeToken = editor.querySelector(".filter-token-exclude");
      expect(excludeToken).toBeInTheDocument();
      expect(excludeToken?.textContent).toBe("status:error");
    });
  });
});
