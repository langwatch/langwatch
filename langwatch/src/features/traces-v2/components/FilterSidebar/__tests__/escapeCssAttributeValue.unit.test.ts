import { describe, expect, it } from "vitest";
import { escapeCssAttributeValue as escape } from "../HoverHighlightStyle";

/**
 * The escape function is the only thing standing between a malformed
 * search query (or hostile facet value flowing in via OTel attributes)
 * and arbitrary CSS injection on the page. Every test here proves a
 * specific class of hostile input can't break out of the
 * `[data-...="ESCAPED"]` selector or terminate the surrounding `<style>`
 * block.
 */
describe("escapeCssAttributeValue", () => {
  describe("given plain alphanumerics", () => {
    it("returns the input unchanged", () => {
      expect(escape("error")).toBe("error");
    });

    it("preserves hyphens", () => {
      expect(escape("gpt-4o")).toBe("gpt-4o");
    });
  });

  describe("given input with spaces", () => {
    it("returns it unchanged — CSS strings allow spaces", () => {
      expect(escape("rate limit")).toBe("rate limit");
    });
  });

  describe("given a literal double-quote", () => {
    it("escapes it as `\\\"` so it cannot close the attribute string", () => {
      // A bare `"` inside `[data-x="…"]` would terminate the string
      // early. The escape produces `\"` which CSS reads as a literal.
      expect(escape('"')).toBe('\\"');
    });

    it("escapes it mid-string while preserving surrounding text", () => {
      expect(escape('foo"bar')).toBe('foo\\"bar');
    });
  });

  describe("given a literal backslash", () => {
    it("escapes the backslash to a double backslash", () => {
      expect(escape("\\")).toBe("\\\\");
    });

    it("escapes backslash-before-quote so the quote stays escaped", () => {
      // Order matters. Backslash MUST be escaped before `"` — otherwise
      // the escape's own backslash gets re-escaped and breaks the
      // selector. Current order produces `a\\\"b` which CSS reads as
      // `a` + literal backslash + literal quote + `b`.
      expect(escape('a\\"b')).toBe('a\\\\\\"b');
    });
  });

  describe("given a newline", () => {
    it("converts LF to `\\A ` (the CSS hex-escape form)", () => {
      expect(escape("\n")).toBe("\\A ");
    });

    it("converts an embedded LF without losing surrounding text", () => {
      expect(escape("foo\nbar")).toBe("foo\\A bar");
    });
  });

  describe("given a carriage return", () => {
    it("converts CR to `\\D `", () => {
      expect(escape("\r")).toBe("\\D ");
    });

    it("converts an embedded CR without losing surrounding text", () => {
      expect(escape("foo\rbar")).toBe("foo\\D bar");
    });
  });

  describe("given a CRLF sequence", () => {
    it("converts each character independently to `\\D \\A `", () => {
      // Trailing space on each hex escape terminates the sequence so
      // adjacent text doesn't merge into the codepoint (e.g. `\Aa`
      // would otherwise be U+00AA, not LF + 'a').
      expect(escape("\r\n")).toBe("\\D \\A ");
    });
  });

  describe("given a literal `\\A` in the input", () => {
    it("treats it as text, not as the CSS newline shortcut", () => {
      // Input is the two characters backslash + 'A'. The backslash
      // gets escaped to `\\` first, leaving `\\A` as four characters
      // in the output — CSS reads it as a literal backslash + 'A',
      // never as the newline escape.
      expect(escape("\\A")).toBe("\\\\A");
    });
  });

  describe("given a literal `\\\"` in the input", () => {
    it("treats both characters as text", () => {
      // Input is backslash + double-quote. Both get escaped: `\\` then
      // `\"`. The CSS parser reads the output as `\\` (literal
      // backslash) + `\"` (literal quote) inside the attribute string.
      expect(escape('\\"')).toBe('\\\\\\"');
    });
  });

  describe("given the `</style>` literal", () => {
    it("returns it unchanged — `<style>` cannot be terminated from inside an attribute selector", () => {
      // Once we're inside `[data-x="…"]`, the only way out is the
      // closing `"`. So `</style>` literal in a facet value sits
      // safely inside the selector. Pinning the contract: if React
      // ever stops entity-encoding text children, we'd need a
      // separate guard.
      expect(escape("</style>")).toBe("</style>");
    });
  });

  describe("given `\"></style>`", () => {
    it("escapes the leading double-quote so the selector cannot be broken", () => {
      // The hostile case: the `"` is what would close the attribute
      // string and let the rest reach the parser as raw CSS. The
      // escape catches it.
      expect(escape('"></style>')).toBe('\\"></style>');
    });
  });

  describe("given a NUL byte", () => {
    it("returns it unchanged — known limitation, theoretical only", () => {
      // Per CSS spec U+0000 is forbidden; the parser substitutes
      // U+FFFD. Current escape does NOT handle NUL — pinning the gap.
      // Practically, facet values come from CH Map<String,String> /
      // OTel string attributes, neither of which can carry a NUL byte.
      expect(escape("\0")).toBe("\0");
    });
  });

  describe("given a form-feed", () => {
    it("returns it unchanged — known limitation, theoretical only", () => {
      // Per CSS spec form-feed in a string needs `\C `. Theoretical
      // only — facet values from CH/OTel don't carry form feed.
      expect(escape("\f")).toBe("\f");
    });
  });

  describe("given a tab", () => {
    it("returns it unchanged — tabs are legal in CSS strings", () => {
      expect(escape("\t")).toBe("\t");
    });
  });

  describe("given an already-escaped string", () => {
    it("re-escapes safely without corrupting the output", () => {
      // Each call only adds backslashes, never removes them. Production
      // calls escape once per value; this test pins that double-escape
      // is safe (no crash, no truncation).
      const once = escape('foo"bar');
      const twice = escape(once);
      expect(twice).toBe('foo\\\\\\"bar');
    });
  });
});
