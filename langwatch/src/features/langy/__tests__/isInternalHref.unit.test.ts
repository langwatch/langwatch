/**
 * @vitest-environment jsdom
 *
 * The guard itself lives in `~/components/Markdown` (one notion of "internal",
 * shared by markdown links, `useSpaLinkClick` and the panel's navigate
 * handler); its test sits with the langy consumers that drive every branch of
 * it, rather than in `src/components/__tests__`. Importing `Markdown.tsx`
 * pulls the whole component graph in, and doing that inside the
 * `src/components` unit pool is enough extra load to flake
 * `OutputsSection`'s latency-sensitive typing assertions.
 *
 * The environment is declared because the import needs a DOM, not because the
 * predicate does.
 */
import { describe, expect, it } from "vitest";

import { isInternalHref } from "~/components/Markdown";

describe("isInternalHref", () => {
  describe("given a same-app relative path", () => {
    it("treats a single-slash path as internal", () => {
      expect(isInternalHref("/demo/simulations/set_1/batch_1?openRun=run_1")).toBe(
        true,
      );
    });
  });

  describe("given an off-site target", () => {
    it("rejects an absolute url", () => {
      expect(isInternalHref("https://evil.example.com/demo")).toBe(false);
    });

    it("rejects a protocol-relative url", () => {
      expect(isInternalHref("//evil.example.com/demo")).toBe(false);
    });

    it("rejects a backslash the browser would normalise to a protocol-relative jump", () => {
      // Browsers recover from these by turning `\` into `/`, so `/\evil.com`
      // resolves as `//evil.com` — a plain startsWith("//") check would miss it.
      expect(isInternalHref("/\\evil.example.com")).toBe(false);
      expect(isInternalHref("\\/evil.example.com")).toBe(false);
      expect(isInternalHref("/demo\\..\\admin")).toBe(false);
    });

    it("rejects tab/newline/CR the URL parser strips into a protocol-relative jump", () => {
      // The URL parser removes \t \n \r before resolving, so `/\t/evil.com`
      // collapses to `//evil.com` and would slip past a startsWith("//") check.
      expect(isInternalHref("/\t/evil.example.com")).toBe(false);
      expect(isInternalHref("/\n/evil.example.com")).toBe(false);
      expect(isInternalHref("/\r/evil.example.com")).toBe(false);
    });
  });
});
