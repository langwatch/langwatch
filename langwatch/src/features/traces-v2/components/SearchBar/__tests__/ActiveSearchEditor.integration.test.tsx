/**
 * @vitest-environment jsdom
 *
 * DOM-level integration tests for the SearchBar editor's rendered output.
 *
 * These confirm that for queries the user can type, the AST-driven decoration
 * plan flows into the actual DOM as expected — separate `.filter-token`
 * spans for each tag, a `.filter-keyword-and` span for the boolean operator,
 * and a per-token `.filter-token-delete` X widget. If a regression ever
 * eats the user's space (collapsing `model:gpt-* AND status:error` into
 * one merged token), these tests catch it.
 *
 * jsdom doesn't implement every API ProseMirror wants, so we render
 * `ActiveSearchEditor` with `autoFocus={false}` and only inspect the
 * statically rendered DOM. We don't simulate keystrokes here — that path
 * is covered by handleKey/getSuggestionState unit tests.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Stub the DB-backed value-suggestions hook so the editor mounts without a
// tRPC provider. The decoration plumbing and rendered DOM are independent
// of dynamic suggestions, which we cover separately.
vi.mock("../useDynamicValueSuggestions", () => ({
  useDynamicValueSuggestions: () => undefined,
}));

import { ActiveSearchEditor } from "../ActiveSearchEditor";

afterEach(cleanup);

function renderEditor(queryText: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ActiveSearchEditor
        queryText={queryText}
        applyQueryText={() => {
          /* no-op for static-render test */
        }}
        autoFocus={false}
        onHasContentChange={() => {
          /* no-op */
        }}
      />
    </ChakraProvider>,
  );
}

async function waitForEditor(): Promise<HTMLElement> {
  return waitFor(() => {
    const editor = document.querySelector(".tiptap") as HTMLElement | null;
    expect(editor).toBeInTheDocument();
    return editor as HTMLElement;
  });
}

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
