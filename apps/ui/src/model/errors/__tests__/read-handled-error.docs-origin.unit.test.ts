// @vitest-environment node
/**
 * The docs-origin allowlist, asserted from a NON-development runtime.
 */
import { describe, expect, it } from "vitest";

import { readHandledError } from "@langwatch/handled-error/read-handled-error";

const trpcError = (error: unknown) => ({ data: { error } });

const docsLink = (docsUrl: string) =>
  readHandledError(trpcError({ code: "trace_not_found", httpStatus: 404, docsUrl }))?.docsUrl;

describe("readHandledError docs links", () => {
  describe("given a runtime that is not a local development client", () => {
    it("refuses the local docs origin", () => {
      expect(docsLink("http://localhost:3000/errors/query-timeout")).toBeUndefined();
    });

    /**
     * Same origin, different port: the allowlist is compared by origin, so a
     * neighbouring service on the viewer's machine is refused for the same
     * reason and not merely because :3000 was hardcoded somewhere.
     */
    it("refuses another local service pretending to be the docs", () => {
      expect(docsLink("http://localhost:8080/errors")).toBeUndefined();
      expect(docsLink("http://127.0.0.1:3000/errors")).toBeUndefined();
    });

    /**
     * The canonical docs site has to keep working here, or the fix would have
     * bought safety by breaking every real docs link in production.
     */
    it("keeps a link on the canonical docs origin", () => {
      expect(docsLink("https://docs.langwatch.ai/platform/data-retention")).toBe(
        "https://docs.langwatch.ai/platform/data-retention",
      );
    });
  });
});
