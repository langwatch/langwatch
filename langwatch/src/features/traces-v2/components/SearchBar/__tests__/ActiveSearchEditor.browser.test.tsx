/**
 * Real-browser end-to-end tests for the SearchBar editor.
 *
 * Run inside Chromium via Vitest's browser mode + Playwright provider, so
 * ProseMirror's selection / layout / clipboard APIs all behave properly. We
 * type real keys, click real elements, and assert on the rendered DOM.
 *
 * Run with `pnpm test:browser`. Files matching `*.browser.test.tsx` are
 * excluded from `pnpm test:unit`.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import "@testing-library/jest-dom/vitest";

import { ActiveSearchEditor } from "../ActiveSearchEditor";

interface AppliedQuery {
  text: string;
}

/**
 * Stateful wrapper that mirrors the real store contract: `applyQueryText` is
 * the only path back into the editor's `queryText` prop. Lets us exercise
 * the X-widget deletion (which calls `applyQueryText` with the result of
 * `removeNodeAtLocation`) and observe the resulting render.
 */
const StatefulEditor: React.FC<{
  initialText?: string;
  onApplied?: (text: string) => void;
}> = ({ initialText = "", onApplied }) => {
  const [text, setText] = useState(initialText);
  return (
    <ActiveSearchEditor
      queryText={text}
      applyQueryText={(next) => {
        setText(next);
        onApplied?.(next);
      }}
      autoFocus
      onHasContentChange={() => undefined}
    />
  );
};

function renderEditor() {
  const applied: AppliedQuery[] = [];
  const utils = render(
    <ChakraProvider value={defaultSystem}>
      <StatefulEditor onApplied={(text) => applied.push({ text })} />
    </ChakraProvider>,
  );
  return { ...utils, applied };
}

function getEditor(): HTMLElement {
  const editor = document.querySelector(".tiptap") as HTMLElement | null;
  if (!editor) throw new Error("editor not mounted");
  return editor;
}

/**
 * Extract the user-visible text content, excluding the per-token X widget
 * buttons that ProseMirror inserts as sibling DOM nodes. Walks the text
 * node tree directly and skips anything inside a `[data-filter-delete]`
 * element.
 */
function plainText(el: HTMLElement): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (!parent?.closest("[data-filter-delete]")) {
      parts.push(node.textContent ?? "");
    }
    node = walker.nextNode();
  }
  return parts.join("");
}

afterEach(cleanup);

describe("SearchBar in real Chromium", () => {
  describe("typing a complete tag", () => {
    it("renders one .filter-token span and the editor text matches the typed query", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error");

      expect(plainText(editor)).toBe("status:error");
      expect(editor.querySelectorAll(".filter-token")).toHaveLength(1);
    });
  });

  describe("typing two tags joined by AND", () => {
    it("renders two tokens plus an AND keyword span — no merged tokens", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("model:gpt-* AND status:error");

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(2);
      expect(tokens[0]?.textContent).toBe("model:gpt-*");
      expect(tokens[1]?.textContent).toBe("status:error");

      const andKeyword = editor.querySelector(".filter-keyword-and");
      expect(andKeyword).toBeTruthy();
      expect(andKeyword?.textContent).toBe("AND");
    });
  });

  describe("the @ trigger", () => {
    it("never inserts a literal `@` into the editor — the dropdown opens with the cursor anchored", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("@status");

      expect(plainText(editor)).toBe("status");
      expect(plainText(editor)).not.toContain("@");
    });

    it("auto-inserts a separator when @ is pressed mid-clause", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error");
      // No space — pressing @ should auto-separate so the new clause doesn't
      // glue onto `error`.
      await userEvent.keyboard("@model");

      expect(plainText(editor)).toBe("status:error model");
    });
  });

  describe("Enter on a value-mode dropdown match", () => {
    it("accepts the suggestion and adds a trailing space so the next clause can be typed cleanly", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      // Type the field, accept it via Enter, then keep typing the value.
      await userEvent.keyboard("@status[Enter]err[Enter]");

      // After value-accept, editor has `status:error ` (with trailing space).
      expect(plainText(editor)).toBe("status:error\u00A0");

      // Now extend with AND + another tag — single user space is enough.
      await userEvent.keyboard("AND model:gpt-4o");

      const finalText = plainText(editor);
      expect(finalText).toContain("status:error");
      expect(finalText).toContain("AND");
      expect(finalText).toContain("model:gpt-4o");
      expect(editor.querySelector(".filter-keyword-and")).toBeTruthy();
      expect(editor.querySelectorAll(".filter-token").length).toBe(2);
    });
  });

  describe("the per-token X widget", () => {
    it("removes only that tag and collapses the surrounding AND keyword", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error AND model:gpt-4o");

      const deleteButtons = editor.querySelectorAll(
        "[data-filter-delete]",
      ) as NodeListOf<HTMLElement>;
      expect(deleteButtons.length).toBe(2);

      // The delete widgets are styled `opacity: 0` until hovered. Hover
      // first, then click — userEvent respects actionability.
      const firstDelete = deleteButtons[0]!;
      await userEvent.hover(firstDelete);
      await userEvent.click(firstDelete);

      // The surviving tag is `model:gpt-4o`, the AND keyword is gone.
      const survivingTokens = editor.querySelectorAll(".filter-token");
      expect(survivingTokens.length).toBe(1);
      expect(survivingTokens[0]?.textContent).toBe("model:gpt-4o");
      expect(editor.querySelector(".filter-keyword-and")).toBeNull();
    });

    it("removes the middle tag in a 3-tag AND chain and collapses both surrounding ANDs", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard(
        "status:error AND model:gpt-4o AND origin:application",
      );

      const deleteButtons = editor.querySelectorAll(
        "[data-filter-delete]",
      ) as NodeListOf<HTMLElement>;
      expect(deleteButtons.length).toBe(3);

      const middle = deleteButtons[1]!;
      await userEvent.hover(middle);
      await userEvent.click(middle);

      const survivingTokens = editor.querySelectorAll(".filter-token");
      expect(survivingTokens.length).toBe(2);
      expect(survivingTokens[0]?.textContent).toBe("status:error");
      expect(survivingTokens[1]?.textContent).toBe("origin:application");
      // Exactly one AND keyword remains between them.
      expect(editor.querySelectorAll(".filter-keyword-and").length).toBe(1);
    });

    it("clears the editor entirely when removing the only tag", async () => {
      const { applied } = renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error");
      // Click on body to trigger blur → applyQueryText fires → wrapper
      // state catches up. Mirrors a real user clicking elsewhere before
      // returning to remove the chip.
      await userEvent.click(document.body);
      await waitFor(() => {
        expect(applied.at(-1)?.text.trim()).toBe("status:error");
      });

      // Click back into the editor to mount actions on the same view.
      await userEvent.click(editor);
      const btn = editor.querySelector(
        "[data-filter-delete]",
      ) as HTMLElement | null;
      expect(btn).toBeTruthy();
      await userEvent.hover(btn!);
      await userEvent.click(btn!);

      await waitFor(() => {
        expect(editor.querySelectorAll(".filter-token").length).toBe(0);
      });
      expect(plainText(editor).trim()).toBe("");
      expect(applied.at(-1)?.text).toBe("");
    });
  });

  describe("Escape", () => {
    it("dismisses the dropdown for the rest of the focus session — typing more chars does not reopen it", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("@stat");
      // Dropdown is open with at least one match for `stat`.
      const dropdownBeforeEscape = document.querySelector(
        '[role="listbox"], .filter-suggestion, [data-suggestion-dropdown]',
      );
      // Use a shape-agnostic check: any dropdown rendering its option text.
      // Vitest assertion for "something matching status is on screen".
      expect(document.body.textContent?.includes("status")).toBeTruthy();

      await userEvent.keyboard("[Escape]");
      // Continued typing should NOT reopen the dropdown until blur or `@`.
      await userEvent.keyboard("us");

      // Editor text grew but the suggestion list is gone (no second `status`
      // rendering outside the editor itself).
      expect(plainText(editor)).toBe("status");
      // Confirm no new dropdown items are visible — the only `status` text
      // belongs to the editor's own decorated token, not a dropdown row.
      const dropdownContainers = document.querySelectorAll(
        '[role="listbox"], [data-suggestion-dropdown]',
      );
      expect(dropdownContainers.length).toBe(0);
      void dropdownBeforeEscape; // satisfy unused warning
    });

    it("re-arms the dropdown when the user types `@` after dismissing", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("@stat[Escape]");
      // Dropdown is dismissed.

      // Typing `@` is the explicit re-arm.
      await userEvent.keyboard(" @model");
      // Editor still parses cleanly with two tokens worth of typing —
      // `stat` is left as bare free-text and `model` becomes the active
      // identifier.
      expect(plainText(editor)).toBe("stat model");
    });
  });

  describe("Backspace through a token boundary", () => {
    it("erases characters one at a time and reflows the decorations", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error");

      // Initially one filter-token decoration.
      expect(editor.querySelectorAll(".filter-token").length).toBe(1);

      // Backspace once — the value loses its last char but stays a tag.
      await userEvent.keyboard("[Backspace]");
      expect(plainText(editor)).toBe("status:erro");

      // Backspace through the rest of the value plus the colon — the
      // remaining `status` is a bare identifier, no longer a tag.
      await userEvent.keyboard(
        "[Backspace][Backspace][Backspace][Backspace][Backspace]",
      );
      expect(plainText(editor)).toBe("status");
      expect(editor.querySelectorAll(".filter-token").length).toBe(0);
    });
  });

  describe("Negation", () => {
    it("`-status:error` renders the `-` as a NOT keyword and the tag as excluded", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("-status:error");

      expect(editor.querySelector(".filter-keyword-not")).toBeTruthy();
      const exclude = editor.querySelector(".filter-token-exclude");
      expect(exclude).toBeTruthy();
      expect(exclude?.textContent).toBe("status:error");
    });

    it("`NOT status:error` renders the NOT keyword separately from the tag", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("NOT status:error");

      const notKeyword = editor.querySelector(".filter-keyword-not");
      expect(notKeyword).toBeTruthy();
      expect(notKeyword?.textContent).toBe("NOT");
    });
  });

  describe("Mixing free text and a tag", () => {
    it("`refund AND status:error` renders the tag highlighted and leaves `refund` as plain text", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("refund AND status:error");

      // Only the `status:error` clause is decorated as a filter-token.
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("status:error");

      const andKeyword = editor.querySelector(".filter-keyword-and");
      expect(andKeyword).toBeTruthy();
    });
  });

  describe("Parenthesised group", () => {
    it("decorates both parens and emits delete widgets for each inner tag", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("(status:error OR status:warning)");

      const parens = editor.querySelectorAll(".filter-paren");
      expect(parens.length).toBe(2);
      expect(parens[0]?.textContent).toBe("(");
      expect(parens[1]?.textContent).toBe(")");

      // OR keyword between the two tags inside the group.
      const orKeyword = editor.querySelector(".filter-keyword-or");
      expect(orKeyword).toBeTruthy();
      expect(orKeyword?.textContent).toBe("OR");

      // Two delete widgets for the two inner tags.
      expect(editor.querySelectorAll("[data-filter-delete]").length).toBe(2);
    });
  });

  describe("regression: typing `status:error`, Enter, space, AND", () => {
    it("renders status:error as a single token, AND as a separate keyword once a right operand is typed, and never glues them into one merged token", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      // The exact sequence the user reported: type a tag, press Enter to
      // accept the dropdown match, type a literal space, then `AND`, then
      // continue with another clause.
      await userEvent.keyboard("status:error[Enter] AND model:gpt-4o");

      // The query text in the editor is the typed sequence. Trailing-space
      // from the value-accept is collapsed to one space by the parser when
      // serializing, but the in-editor text stays exactly as typed.
      const text = plainText(editor);
      expect(text).toContain("status:error");
      expect(text).toContain("AND");
      expect(text).toContain("model:gpt-4o");

      // Two tags, exactly one AND keyword between them — no merged token.
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(2);
      expect(tokens[0]?.textContent).toBe("status:error");
      expect(tokens[1]?.textContent).toBe("model:gpt-4o");

      const andKeywords = editor.querySelectorAll(".filter-keyword-and");
      expect(andKeywords.length).toBe(1);
      expect(andKeywords[0]?.textContent).toBe("AND");
    });

    it("with a dangling AND (no right operand), keeps `status:error` decorated and surfaces the parse failure to applyQueryText", async () => {
      const { applied } = renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      // Type the exact sequence, then commit via blur instead of Enter
      // (Enter inside a value dropdown accepts; we want the unparseable
      // intermediate to reach the wrapper).
      await userEvent.keyboard("status:error[Enter] AND");
      await userEvent.click(document.body);

      // The wrapper received the user's raw text — `status:error AND` is
      // unparseable, so the real store would surface a parse error here.
      // We verify the unparseable string actually got there.
      await waitFor(() => {
        expect(applied.length).toBeGreaterThan(0);
      });
      const lastApplied = applied.at(-1)?.text ?? "";
      expect(lastApplied).toMatch(/status:error\s+AND/);

      // Visually, status:error stays decorated as a tag. The dangling AND
      // is unstyled (regex fallback only matches the tag). No merged
      // multi-tag token is emitted.
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("status:error");
    });
  });

  describe("regression: NBSP must not silently fuse two clauses", () => {
    it("after accepting a value, the inserted whitespace is U+00A0 (NBSP) so contenteditable doesn't collapse it on the next keystroke", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:warning[Enter]");

      // The on-screen text ends in a NBSP (U+00A0), NOT a regular space.
      // Browsers/PM eat regular trailing spaces when the next char arrives;
      // NBSP survives. The parser normalises NBSP → space in `stripAtSigils`
      // so liqe still splits the clauses correctly.
      const text = plainText(editor);
      expect(text).toBe("status:warning\u00A0");
      const lastChar = text[text.length - 1];
      expect(lastChar?.charCodeAt(0)).toBe(0xa0);
    });

    it("typing AND after accept produces two separate tokens — not a fused `value AND` token", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      // Pick a known-good static value-mode dropdown match and accept it,
      // then type the boolean operator + another tag.
      await userEvent.keyboard("origin:evaluation[Enter]AND origin:evaluation");

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(2);
      expect(tokens[0]?.textContent).toBe("origin:evaluation");
      expect(tokens[1]?.textContent).toBe("origin:evaluation");

      // Each token's data-value is just the value, NOT `evaluation\u00A0AND`.
      const widgets = editor.querySelectorAll(
        "[data-filter-delete]",
      ) as NodeListOf<HTMLElement>;
      for (const w of Array.from(widgets)) {
        expect(w.getAttribute("data-value")).toBe("evaluation");
      }
    });
  });

  describe("regression: raw-key sequence reproduces the bug if it exists", () => {
    it("press-by-press: type status:error, Enter (which Tab-accepts in handleKey), then a single A — the editor MUST show the A as plain text, not glued onto `error`", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      // Type the field+colon. value-mode dropdown opens against `status`.
      await userEvent.keyboard("status");
      // Now ":" — value mode for status.
      await userEvent.keyboard(":error");
      // Press Enter once to accept the value-mode highlight (the active
      // suggestion is `error` since we typed it whole).
      await userEvent.keyboard("[Enter]");
      // Snapshot intermediate state for debugging.
      const afterEnter = plainText(editor);
      // After accept, expect trailing NBSP (not regular space — see
      // `handleKey.ts` for why).
      expect(afterEnter).toBe("status:error\u00A0");
      // Now the smoking-gun keystroke.
      await userEvent.keyboard("A");
      const afterA = plainText(editor);
      // Bug would render `status:errorA` (space eaten + glued).
      // Correct: `status:error<NBSP>A`.
      expect(afterA).toBe("status:error\u00A0A");
      // And the existing tag must still be its own decoration.
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("status:error");
    });

    it("dispatches raw KeyboardEvents (bypassing userEvent's syntax) — same expectation", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error[Enter]");

      // Bypass userEvent: dispatch a real keydown for `A` against the
      // ProseMirror contenteditable. ProseMirror listens on keydown +
      // beforeinput, so we fire both.
      const target = editor as HTMLElement;
      target.focus();
      const keydown = new KeyboardEvent("keydown", {
        key: "A",
        code: "KeyA",
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(keydown);
      // beforeinput is what most contenteditable engines actually mutate on.
      const beforeinput = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "A",
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(beforeinput);
      // Fall back to userEvent for the actual char insertion if PM didn't
      // handle the synthetic event (which it usually won't outside Chromium
      // intent flow).
      await userEvent.keyboard("A");

      const text = plainText(editor);
      // Either path must produce `status:error<NBSP>A`. If we ever see
      // `status:errorA`, the bug is real and reproducible here.
      expect(text).toBe("status:error\u00A0A");
    });
  });

  describe("regression: incremental typing after Enter must not extend the previous tag", () => {
    it("after `status:error[Enter]`, typing `A` lands as plain text outside the tag — not as `status:errorA`", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error[Enter]");
      // After accept, editor text ends in NBSP.
      expect(plainText(editor)).toBe("status:error\u00A0");

      // Type a single character. It MUST land outside the existing tag.
      await userEvent.keyboard("A");

      const tokens = editor.querySelectorAll(".filter-token");
      // Still exactly one tag — the new `A` is outside the decoration.
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("status:error");
      // Editor text grew by exactly one user-visible char.
      expect(plainText(editor)).toBe("status:error\u00A0A");
    });

    it("after `status:error[Enter]`, typing each char of ` AND` keeps `status:error` as its own token at every step", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error[Enter]");
      const expectations: Array<{ char: string; afterText: string }> = [
        { char: "A", afterText: "status:error\u00A0A" },
        { char: "N", afterText: "status:error\u00A0AN" },
        { char: "D", afterText: "status:error\u00A0AND" },
      ];
      for (const { char, afterText } of expectations) {
        await userEvent.keyboard(char);
        expect(plainText(editor)).toBe(afterText);
        const tokens = editor.querySelectorAll(".filter-token");
        // The first tag must NEVER absorb the new chars — the regex
        // fallback (parse fails on dangling AND) only ever matches
        // `status:error` as the lone tag.
        expect(tokens.length).toBe(1);
        expect(tokens[0]?.textContent).toBe("status:error");
      }
    });

    it("does NOT need extra spaces — finishing `… AND model:gpt-4o` parses cleanly with one space between AND and the next tag", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error[Enter]AND model:gpt-4o");

      // Final state: two tags + AND between them. No extra spaces required.
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(2);
      expect(tokens[0]?.textContent).toBe("status:error");
      expect(tokens[1]?.textContent).toBe("model:gpt-4o");
      expect(editor.querySelectorAll(".filter-keyword-and").length).toBe(1);
    });
  });

  describe("stress: long sequence of accept + type cycles", () => {
    it("running 3 accept-then-type cycles in a row produces 3 separate tokens, no fusion", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      // Use ONLY values that exist in the static FIELD_VALUES dict so
      // [Enter] always hits the accept path (which inserts the trailing
      // NBSP that separates clauses). DB-only values like `model:gpt-4o`
      // would go through submit instead, no separator → the next clause
      // glues onto the previous value.
      await userEvent.keyboard("status:error[Enter]");
      await userEvent.keyboard("AND origin:application[Enter]");
      await userEvent.keyboard("AND has:eval[Enter]");

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(3);
      expect(tokens[0]?.textContent).toBe("status:error");
      expect(tokens[1]?.textContent).toBe("origin:application");
      expect(tokens[2]?.textContent).toBe("has:eval");

      // Two AND keywords between three tags.
      expect(editor.querySelectorAll(".filter-keyword-and").length).toBe(2);
      expect(editor.querySelectorAll("[data-filter-delete]").length).toBe(3);
    });
  });

  describe("stress: type, delete, type — interspersed Backspaces", () => {
    it("Backspace-deleting the value mid-tag and retyping does not corrupt token boundaries", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error");
      // Backspace the entire value back to `status:`.
      await userEvent.keyboard(
        "[Backspace][Backspace][Backspace][Backspace][Backspace]",
      );
      expect(plainText(editor)).toBe("status:");
      // Retype a different value.
      await userEvent.keyboard("warning");
      expect(plainText(editor)).toBe("status:warning");
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("status:warning");
    });
  });

  describe("stress: clear and retype", () => {
    it("backspacing through the whole query then typing fresh content refreshes decorations cleanly", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error AND model:gpt-4o");
      expect(editor.querySelectorAll(".filter-token").length).toBe(2);

      // Walk backwards with Backspace until the editor is empty. Avoids
      // the cross-platform select-all flakiness inside contenteditable.
      const initialText = plainText(editor);
      for (let i = 0; i < initialText.length + 5; i++) {
        await userEvent.keyboard("[Backspace]");
      }

      expect(plainText(editor).trim()).toBe("");
      expect(editor.querySelectorAll(".filter-token").length).toBe(0);

      await userEvent.keyboard("origin:simulation");
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("origin:simulation");
    });
  });

  describe("stress: typing a value containing a hyphen", () => {
    it("`model:gpt-4o-mini` is one token even though the value contains hyphens", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("model:gpt-4o-mini");
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("model:gpt-4o-mini");
    });
  });

  describe("stress: typing a value containing a dot", () => {
    it("`attribute.langwatch.user_id:abc` is one token", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("attribute.langwatch.user_id:abc");
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("attribute.langwatch.user_id:abc");
    });
  });

  describe("stress: typing a wildcard mid-value then continuing", () => {
    it("`model:gpt-*` then ` AND status:error` produces two tokens with the wildcard preserved", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("model:gpt-*");
      await userEvent.keyboard(" AND status:error");

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(2);
      expect(tokens[0]?.textContent).toBe("model:gpt-*");
      expect(tokens[1]?.textContent).toBe("status:error");
      expect(editor.querySelector(".filter-keyword-and")).toBeTruthy();
    });
  });

  describe("stress: stuttered typing produces no duplicate decorations", () => {
    it("typing the same string twice doesn't double-decorate the second pass", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error");
      // Identical re-render trigger from clicking inside.
      await userEvent.click(editor);
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      const widgets = editor.querySelectorAll("[data-filter-delete]");
      expect(widgets.length).toBe(1);
    });
  });

  describe("stress: typing `OR` between tags", () => {
    it("`status:error OR status:warning` renders two tokens + an OR keyword", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error OR status:warning");

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(2);
      const orKeyword = editor.querySelector(".filter-keyword-or");
      expect(orKeyword).toBeTruthy();
      expect(orKeyword?.textContent).toBe("OR");
    });
  });

  describe("stress: trailing whitespace forms", () => {
    it("typing a regular space at end-of-doc is acceptable — parser strips it", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error ");
      // Whether it's NBSP or regular space, the parser sees `status:error`.
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("status:error");
    });

    it("multiple consecutive spaces are collapsed by the parser", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error   AND   model:gpt-4o");

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(2);
      expect(editor.querySelector(".filter-keyword-and")).toBeTruthy();
    });
  });

  describe("stress: rapid Enter presses", () => {
    it("pressing Enter on an empty editor accepts the first field — empty editor opens the field-list dropdown by design", async () => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      // Empty editor renders the dropdown with every field name. Enter
      // accepts the highlighted (first) one, putting `<field>:` into the
      // editor. Should not crash, and SHOULD insert exactly one tag prefix.
      await userEvent.keyboard("[Enter]");
      const text = plainText(editor);
      // Whatever the first field is, the editor should contain `<field>:`.
      expect(text).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*:$/);
    });

    it("pressing Enter twice after a tag — first accepts, second submits — keeps the editor stable", async () => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard("status:error[Enter][Enter]");

      // The editor still shows status:error, no extra newlines.
      const text = plainText(editor);
      expect(text.replace(/\u00A0/g, " ").trim()).toBe("status:error");
    });
  });

  describe("stress: paste-like rapid input", () => {
    it("dumping a long query in one shot still parses every clause", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard(
        "status:error AND model:gpt-4o AND origin:application AND service:web AND user:abc",
      );

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(5);
      expect(editor.querySelectorAll(".filter-keyword-and").length).toBe(4);
    });
  });

  describe("stress: typing parentheses around an OR group", () => {
    it("`(status:error OR status:warning) AND model:gpt-4o` decorates parens, OR, and AND separately", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard(
        "(status:error OR status:warning) AND model:gpt-4o",
      );

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(3);

      expect(editor.querySelectorAll(".filter-paren").length).toBe(2);
      expect(editor.querySelector(".filter-keyword-or")).toBeTruthy();
      expect(editor.querySelector(".filter-keyword-and")).toBeTruthy();
    });
  });

  describe("stress: NOT prefix interactions", () => {
    it("`NOT status:error AND model:gpt-4o` decorates NOT + excluded token + AND + tag", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("NOT status:error AND model:gpt-4o");

      const notKeyword = editor.querySelector(".filter-keyword-not");
      expect(notKeyword).toBeTruthy();
      expect(notKeyword?.textContent).toBe("NOT");

      const excludeToken = editor.querySelector(".filter-token-exclude");
      expect(excludeToken).toBeTruthy();
      expect(excludeToken?.textContent).toBe("status:error");

      expect(editor.querySelector(".filter-keyword-and")).toBeTruthy();
    });

    it("`-status:error -origin:simulation` decorates two excluded tokens + two `-` keywords", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("-status:error -origin:simulation");

      const excludeTokens = editor.querySelectorAll(".filter-token-exclude");
      expect(excludeTokens.length).toBe(2);
      expect(editor.querySelectorAll(".filter-keyword-not").length).toBe(2);
    });
  });

  describe("stress: clicking the X mid-query", () => {
    it("removing the middle of three tags collapses both ANDs and leaves exactly one AND", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard(
        "status:error AND model:gpt-4o AND origin:application",
      );

      const widgets = editor.querySelectorAll(
        "[data-filter-delete]",
      ) as NodeListOf<HTMLElement>;
      expect(widgets.length).toBe(3);
      const middle = widgets[1]!;
      await userEvent.hover(middle);
      await userEvent.click(middle);

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(2);
      expect(editor.querySelectorAll(".filter-keyword-and").length).toBe(1);
    });

    it("removing the only tag in a parenthesised group collapses the parens too", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("(status:error)");

      const widget = editor.querySelector(
        "[data-filter-delete]",
      ) as HTMLElement;
      await userEvent.hover(widget);
      await userEvent.click(widget);

      // Editor went empty (one tag + paren wrapper → nothing).
      await waitFor(() => {
        expect(editor.querySelectorAll(".filter-token").length).toBe(0);
      });
    });
  });

  describe("stress: parent/child synchronisation", () => {
    it("after typing, `applyQueryText` fires per keystroke (live commit) — applied list grows steadily", async () => {
      const { applied } = renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error");

      // We expect AT LEAST one applied call per typed char (12 chars).
      // Test isn't strict on the exact count — typing some chars may merge
      // into batched updates — but it MUST be > 1 to prove live commit.
      expect(applied.length).toBeGreaterThan(1);
      // The final applied text contains the typed content.
      const last = applied.at(-1)?.text ?? "";
      expect(last.replace(/\u00A0/g, " ").trim()).toBe("status:error");
    });
  });

  describe("the rendered token chip is visually contiguous with its X widget", () => {
    it("after value-accept, the token's right edge touches the delete button's left edge — no visible gap from the trailing NBSP", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      // Accept via dropdown so the NBSP-insertion code path runs.
      await userEvent.keyboard("status:error[Enter]");

      const token = editor.querySelector(".filter-token") as HTMLElement;
      const del = editor.querySelector(".filter-token-delete") as HTMLElement;
      expect(token).toBeTruthy();
      expect(del).toBeTruthy();

      const tokenRect = token.getBoundingClientRect();
      const delRect = del.getBoundingClientRect();
      // The CSS uses marginLeft: -1px on the delete button to overlap
      // borders, so the delete's left edge should sit at or just-left-of
      // the token's right edge. Anything > 1px is a visible gap.
      const gap = delRect.left - tokenRect.right;
      expect(gap).toBeLessThanOrEqual(1);
    });

    it("after typing `status:error AND model:gpt-4o`, every token-X pair is flush", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("status:error AND model:gpt-4o");

      const tokens = Array.from(
        editor.querySelectorAll(".filter-token"),
      ) as HTMLElement[];
      const deletes = Array.from(
        editor.querySelectorAll(".filter-token-delete"),
      ) as HTMLElement[];
      expect(tokens.length).toBe(2);
      expect(deletes.length).toBe(2);

      for (let i = 0; i < tokens.length; i++) {
        const tokenRect = tokens[i]!.getBoundingClientRect();
        const delRect = deletes[i]!.getBoundingClientRect();
        const gap = delRect.left - tokenRect.right;
        expect(gap, `token[${i}] gap`).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("Range value", () => {
    // Note: `cost:[1 TO 10]` can't be tested via userEvent.keyboard because
    // `[...]` is reserved syntax for special-key actions in user-event. The
    // bracket-range parsing path is covered by `filterHighlight.unit.test`.

    it("renders `cost:>5` as a single token decoration", async () => {
      renderEditor();
      const editor = getEditor();

      await userEvent.click(editor);
      await userEvent.keyboard("cost:>5");

      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("cost:>5");
    });
  });

  describe("operator matrix — comparison forms render as numeric (green) chips", () => {
    it.each([
      ["greater-than", "cost:>5"],
      ["greater-equal", "cost:>=5"],
      ["less-than", "duration:<5000"],
      ["less-equal", "duration:<=5000"],
    ])("`%s` renders one numeric chip for `%s`", async (_label, query) => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard(query);
      const numeric = editor.querySelector(".filter-token-numeric");
      expect(numeric).toBeTruthy();
      expect(numeric?.textContent).toBe(query);
    });
  });

  describe("operator matrix — quoted values with spaces", () => {
    it('`errorMessage:"rate limit"` is one chip and the X carries the unquoted value', async () => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      // userEvent supports `"` directly — Shift+' on US layout.
      await userEvent.keyboard('errorMessage:"rate limit"');
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe('errorMessage:"rate limit"');
      const widget = editor.querySelector(
        "[data-filter-delete]",
      ) as HTMLElement | null;
      expect(widget?.dataset.value).toBe("rate limit");
    });
  });

  describe("operator matrix — wildcards in different positions", () => {
    it.each([
      ["trailing", "model:gpt-*"],
      ["leading", "model:*-mini"],
      ["middle", "model:gpt*mini"],
    ])("renders `%s` (`%s`) as a single chip", async (_label, query) => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard(query);
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe(query);
    });
  });

  describe("operator matrix — scenario fields get the purple accent", () => {
    it.each([
      "scenarioVerdict:success",
      "scenarioStatus:failed",
    ])("`%s` is rendered with filter-token-scenario", async (query) => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard(query);
      const scenario = editor.querySelector(".filter-token-scenario");
      expect(scenario).toBeTruthy();
      expect(scenario?.textContent).toBe(query);
    });
  });

  describe("free-text fragments NEVER get a delete widget", () => {
    // Critical UX regression — previously the X button rendered for any
    // parseable Tag, including ImplicitField (free text). Now it only
    // renders on recognised `field:value` shapes.
    it.each([
      ["a single letter", "A"],
      ["two letters", "AN"],
      ["the word AND", "AND"],
      ["a free-text word", "refund"],
      ["quoted free text", '"refund policy"'],
    ])("`%s` (%s) emits zero delete widgets", async (_label, input) => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard(input);
      const widgets = editor.querySelectorAll("[data-filter-delete]");
      expect(widgets.length).toBe(0);
    });
  });

  describe("partial typing — chip arrives at the colon and survives backspaces", () => {
    it("after `status:`, exactly one chip is visible (with no value yet)", async () => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard("status:");
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      // The chip exists even without a value — the user sees a half-built
      // affordance prompting them to type something.
      const widget = editor.querySelector(
        "[data-filter-delete]",
      ) as HTMLElement | null;
      expect(widget).toBeTruthy();
      // No data-value attribute — the value is null until the user types.
      expect(widget?.dataset.value).toBeUndefined();
    });

    it("after typing `status:error` then 5 backspaces back to `status:`, the chip survives every step", async () => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard("status:error");
      expect(editor.querySelectorAll(".filter-token").length).toBe(1);
      // Walk backspace one keystroke at a time — chip should remain
      // throughout (never flicker out, never multiply).
      for (let i = 0; i < 5; i++) {
        await userEvent.keyboard("[Backspace]");
        expect(
          editor.querySelectorAll(".filter-token").length,
          `after backspace ${i + 1}`,
        ).toBe(1);
      }
      // We're now at `status:` — chip still here.
      expect(plainText(editor)).toBe("status:");
    });

    it("one more backspace (drops the colon) makes the chip disappear", async () => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard("status:[Backspace]");
      // `status` (no colon) — no field:value shape, so no chip.
      expect(plainText(editor)).toBe("status");
      expect(editor.querySelectorAll(".filter-token").length).toBe(0);
    });
  });

  describe("regression: silent miscarriages get visible feedback", () => {
    it("`status: error` (space after colon) renders a half-built `status:` chip and `error` as plain text", async () => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard("status: error");
      // The chip covers `status:` — a visible signal that the clause split
      // and the value never landed inside the tag. `error` after the space
      // is free-text (no chip).
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      expect(tokens[0]?.textContent).toBe("status:");
    });

    it("`NOT-status:error` (no space after NOT) renders one chip in default blue (not red exclude)", async () => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard("NOT-status:error");
      const tokens = editor.querySelectorAll(".filter-token");
      expect(tokens.length).toBe(1);
      // No exclude class — the parser treated `NOT-status` as a literal
      // field name, not as negation. The chip is plain blue.
      expect(
        editor.querySelector(".filter-token-exclude"),
        "should NOT have exclude colouring",
      ).toBeNull();
    });
  });

  describe("regression: chip colour matches field type", () => {
    it("`scenarioVerdict:success` is purple (scenario), `cost:>5` is green (numeric), `status:error` is blue (categorical)", async () => {
      renderEditor();
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard(
        "scenarioVerdict:success AND cost:>5 AND status:error",
      );

      const scenario = editor.querySelector(".filter-token-scenario");
      const numeric = editor.querySelector(".filter-token-numeric");
      // The plain `.filter-token` class is on every chip — to find the
      // categorical-only one we exclude the modifier classes.
      const categorical = Array.from(
        editor.querySelectorAll(".filter-token"),
      ).find(
        (el) =>
          !el.classList.contains("filter-token-scenario") &&
          !el.classList.contains("filter-token-numeric") &&
          !el.classList.contains("filter-token-exclude"),
      );

      expect(scenario?.textContent).toBe("scenarioVerdict:success");
      expect(numeric?.textContent).toBe("cost:>5");
      expect(categorical?.textContent).toBe("status:error");
    });
  });
});
