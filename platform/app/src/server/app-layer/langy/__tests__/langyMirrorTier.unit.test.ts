/**
 * @vitest-environment node
 *
 * Pins the ADR-061 mirror-tier resolver's v1 behaviour: content by default,
 * and the mandatory self-skip so the mirror project never mirrors its own
 * turns into itself (the one genuine self-ingest loop). The per-org policy
 * store is a later seam; until it lands every customer org is `content`.
 */
import { describe, expect, it } from "vitest";

import { resolveLangyMirrorTier } from "../LangyCredentialService";

describe("resolveLangyMirrorTier", () => {
  describe("when no mirror project id is configured", () => {
    it("defaults every project to content", () => {
      expect(resolveLangyMirrorTier({ projectId: "proj-customer" }, {})).toBe(
        "content",
      );
    });
  });

  describe("when the turn's project is NOT the mirror project", () => {
    it("resolves content", () => {
      expect(
        resolveLangyMirrorTier(
          { projectId: "proj-customer" },
          { LANGY_MIRROR_PROJECT_ID: "proj-mirror" },
        ),
      ).toBe("content");
    });
  });

  describe("when the turn's own project IS the mirror project", () => {
    it("resolves skip — a turn never mirrors into itself", () => {
      expect(
        resolveLangyMirrorTier(
          { projectId: "proj-mirror" },
          { LANGY_MIRROR_PROJECT_ID: "proj-mirror" },
        ),
      ).toBe("skip");
    });

    it("tolerates surrounding whitespace in the configured id", () => {
      expect(
        resolveLangyMirrorTier(
          { projectId: "proj-mirror" },
          { LANGY_MIRROR_PROJECT_ID: "  proj-mirror  " },
        ),
      ).toBe("skip");
    });
  });
});
