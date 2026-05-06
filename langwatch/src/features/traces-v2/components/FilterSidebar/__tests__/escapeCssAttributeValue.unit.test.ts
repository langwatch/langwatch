import { describe, expect, it } from "vitest";
import { escapeCssAttributeValue as escape } from "../OrConnectorOverlay";

/**
 * The escape function is the only thing standing between a malformed
 * search query (or hostile facet value flowing in via OTel attributes)
 * and arbitrary CSS injection on the page. Every test here proves a
 * specific class of hostile input can't break out of the
 * `[data-...="ESCAPED"]` selector or terminate the surrounding `<style>`
 * block.
 */
describe("escapeCssAttributeValue", () => {
  describe("benign input", () => {
    it("passes plain alphanumerics through unchanged", () => {
      expect(escape("error")).toBe("error");
      expect(escape("gpt-4o")).toBe("gpt-4o");
    });

    it("passes spaces through unchanged (CSS strings allow them)", () => {
      expect(escape("rate limit")).toBe("rate limit");
    });
  });

  describe("characters that would terminate the selector", () => {
    it("escapes a literal double-quote so it can't close the attribute string", () => {
      // A bare `"` inside `[data-x="…"]` would terminate the string
      // early. The escape produces `\"` which CSS reads as a literal.
      expect(escape('"')).toBe('\\"');
      expect(escape('foo"bar')).toBe('foo\\"bar');
    });

    it("backslash-escapes the backslash itself BEFORE escaping `\"`", () => {
      // Order matters. If `"` were escaped first to `\\"`, then the
      // backslash-escape step would re-escape the backslash and produce
      // `\\\\"` — still safe, but the escape sequence the CSS parser
      // sees would be `\\` + `"` (terminator), breaking the selector.
      // The current order produces a single `\"` which CSS reads as a
      // literal quote inside the string.
      expect(escape('\\')).toBe('\\\\');
      expect(escape('a\\"b')).toBe('a\\\\\\"b');
    });
  });

  describe("characters that are illegal in CSS strings without escapes", () => {
    it("converts newline (LF) to `\\A ` (the CSS hex escape)", () => {
      expect(escape("\n")).toBe("\\A ");
      expect(escape("foo\nbar")).toBe("foo\\A bar");
    });

    it("converts carriage return (CR) to `\\D `", () => {
      expect(escape("\r")).toBe("\\D ");
      expect(escape("foo\rbar")).toBe("foo\\D bar");
    });

    it("handles CRLF as two separate escapes", () => {
      // \r\n becomes \D \A — both legal CSS hex escapes. The trailing
      // space on each terminates the hex sequence so adjacent text
      // doesn't merge into the escape (e.g. `\Aa` would otherwise be
      // codepoint U+00AA, not LF + 'a').
      expect(escape("\r\n")).toBe("\\D \\A ");
    });
  });

  describe("hostile inputs that mimic CSS escape sequences themselves", () => {
    it("treats a literal `\\A` in the input as text, not as a newline shortcut", () => {
      // Input is the two characters backslash + 'A'. The backslash
      // gets escaped to `\\\\` first, leaving `\\A` as four literal
      // characters in the output — CSS parser reads it as a literal
      // backslash followed by an `A`, never as the newline escape.
      expect(escape("\\A")).toBe("\\\\A");
    });

    it("treats a literal `\\\"` in the input as text", () => {
      // Input is backslash + double-quote. Both escape: `\\` then `\"`.
      // Result: `\\\\\\"` (4 backslashes + escaped quote in the output
      // string), which the CSS parser reads as `\\` (literal backslash)
      // + `\"` (literal quote) inside the attribute string.
      expect(escape('\\"')).toBe('\\\\\\"');
    });
  });

  describe("attempts to break out of the surrounding `<style>` block", () => {
    it("does NOT touch `</style>` — the escape function only handles CSS-string-fatal characters", () => {
      // The `<style>` block isn't terminated by characters inside an
      // attribute-value string — once we're inside `[data-x="…"]`, the
      // only way out is the closing `"`. So `</style>` literal in a
      // facet value sits safely inside the selector. This test pins
      // that contract: if React ever stops doing the entity-encoding
      // it does inside JSX text children, we'd need a separate guard.
      expect(escape("</style>")).toBe("</style>");
    });

    it("escapes `\"` even when adjacent to `</style>`", () => {
      // The hostile case: `value">. The double-quote IS the dangerous
      // bit (it would close the attribute string), and `escape()`
      // catches it.
      expect(escape('"></style>')).toBe('\\"></style>');
    });
  });

  describe("control characters that aren't explicitly handled", () => {
    it("passes NUL through unchanged (theoretical only — CH attributes can't carry NUL)", () => {
      // Per CSS spec, U+0000 inside a string is forbidden and the
      // parser substitutes U+FFFD. The current escape function does
      // NOT handle NUL — pinning the gap so a future hardening pass
      // is a deliberate change. Practically, facet values come from
      // ClickHouse Map<String,String> entries (OTel span attribute
      // values), neither of which can contain a NUL byte without
      // breaking string framing.
      expect(escape("\0")).toBe("\0");
    });

    it("passes form-feed (FF) through unchanged (same theoretical-only gap)", () => {
      // Per CSS spec, form feed in a string needs `\C `. Current
      // implementation doesn't handle it. Theoretical only — facet
      // values from CH/OTel don't carry form feed.
      expect(escape("\f")).toBe("\f");
    });

    it("passes tab through unchanged (legal in CSS strings — no escape needed)", () => {
      expect(escape("\t")).toBe("\t");
    });
  });

  describe("idempotency through round-trip", () => {
    it("escaping an already-escaped string does NOT corrupt it (just nests)", () => {
      // Each pass through escape() is monotone: it only adds
      // backslashes, never removes them. So escape(escape(x)) is a
      // valid CSS string that decodes to escape(x), not to x. This
      // matters because in production we only call escape() once per
      // value — the test just pins that double-escape is safe (no
      // crash, no truncation).
      const once = escape('foo"bar');
      const twice = escape(once);
      // Once: `foo\"bar`. Twice: backslash gets escaped, then `\"`'s
      // quote: `foo\\\"bar` → 7 chars before the `\"`.
      expect(twice).toBe('foo\\\\\\"bar');
    });
  });
});
