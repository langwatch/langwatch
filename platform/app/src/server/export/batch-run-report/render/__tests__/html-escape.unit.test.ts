import { describe, expect, it } from "vitest";
import { escapeAttr, escapeHtml } from "../html-escape";

describe("Feature: Run report — escaping", () => {
  describe("given a string containing markup", () => {
    /** @scenario Text from the analysis is shown as text */
    it("escapes every one of the five characters that can end a text node", () => {
      expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
    });

    /** @scenario Text from the analysis is shown as text */
    it("renders an image tag as visible text rather than an element", () => {
      expect(escapeHtml("<img src=x onerror=alert(1)>")).toBe(
        "&lt;img src=x onerror=alert(1)&gt;",
      );
    });

    /** @scenario Text from the analysis is shown as text */
    it("neutralises a closing script tag", () => {
      expect(escapeHtml("</script><script>alert(1)</script>")).not.toContain(
        "<script",
      );
    });
  });

  describe("given a string bound for an attribute", () => {
    /** @scenario A scenario named like markup is shown as text */
    it("escapes both quote characters so the attribute cannot be closed early", () => {
      expect(escapeAttr(`" onmouseover="alert(1)`)).toBe(
        "&quot; onmouseover=&quot;alert(1)",
      );
      expect(escapeAttr("' onmouseover='alert(1)")).toBe(
        "&#39; onmouseover=&#39;alert(1)",
      );
    });
  });

  describe("given a string with nothing to escape", () => {
    /** @scenario The same run produces the same report twice */
    it("returns the string unchanged", () => {
      expect(escapeHtml("Checkout with a coupon")).toBe(
        "Checkout with a coupon",
      );
    });
  });

  describe("given an ampersand that is already part of an entity", () => {
    /** @scenario Text from the analysis is shown as text */
    it("escapes the ampersand so the entity reads back literally", () => {
      expect(escapeHtml("&amp;")).toBe("&amp;amp;");
    });
  });
});
