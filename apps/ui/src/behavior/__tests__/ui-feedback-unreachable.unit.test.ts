/**
 * The one question answered BEFORE the code-keyed registry: did we get an
 * answer at all? `resolveUiFailureCopy` is the single seam both surfaces
 * resolve through, so the check lives there — pinning order, not wording.
 */
import { describe, expect, it } from "vitest";

import { resolveUiFailureCopy } from "../ui-feedback";

describe("resolving the words for a failure", () => {
  describe("when nothing answered at all", () => {
    it("says we are waiting rather than promising a report", () => {
      const copy = resolveUiFailureCopy({ error: new Error("Failed to fetch") });

      expect(copy.title).toBe("Waiting for LangWatch");
      expect(copy.description).toContain("can't reach the server");
      expect(copy.description).not.toContain("notified");
    });

    it("offers no trace id, because no request produced one", () => {
      const copy = resolveUiFailureCopy({ error: new Error("Failed to fetch") });

      expect(copy.traceId).toBeUndefined();
      expect(copy.docsUrl).toBeUndefined();
    });

    // The screen's own title names the ACTION that failed, and the action is
    // not what went wrong here.
    it("drops the screen's fallback title", () => {
      const copy = resolveUiFailureCopy({
        error: new Error("Failed to fetch"),
        fallbackTitle: "Couldn't save your changes",
      });

      expect(copy.title).toBe("Waiting for LangWatch");
    });

    it("says so for a gateway status carrying no answer of ours", () => {
      const copy = resolveUiFailureCopy({
        error: { message: "", meta: { response: { status: 503 } } },
      });

      expect(copy.title).toBe("Waiting for LangWatch");
    });
  });

  describe("when the server answered", () => {
    // The whole safety of putting the check first: a refusal we can name must
    // never be repainted as "we can't reach the server", which would discard
    // copy the reader can act on.
    it("keeps the screen's own account of a named refusal", () => {
      const copy = resolveUiFailureCopy({
        error: { message: "Failed to fetch", data: { httpStatus: 403, code: "FORBIDDEN" } },
        fallbackTitle: "Couldn't save your changes",
      });

      expect(copy.title).not.toBe("Waiting for LangWatch");
    });
  });
});
