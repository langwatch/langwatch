import { describe, expect, it } from "vitest";

import { releaseFlags } from "../release-flags.ts";
import { uiTokens } from "../ui-tokens.ts";

describe("uiTokens", () => {
  describe("given an owner minting tokens", () => {
    it("scopes a component's key by its owner", () => {
      const token = uiTokens("trace").component<{ traceId: string }>("traceIdPeek");

      expect(token.key).toBe("trace.traceIdPeek");
      expect(token.owner).toBe("trace");
      expect(token.kind).toBe("component");
    });

    it("keeps a drawer's wire name as its key", () => {
      const token = uiTokens("evaluator").drawer<{ evaluatorId?: string }>("evaluatorEditor");

      expect(token.key).toBe("evaluatorEditor");
    });

    it("freezes the token", () => {
      expect(Object.isFrozen(uiTokens("trace").hooks<object>("peekHooks"))).toBe(true);
    });
  });
});

describe("releaseFlags", () => {
  describe("given the names a module owns", () => {
    it("answers one frozen token per name", () => {
      const flags = releaseFlags(["release_a", "release_b"]);

      expect(flags.release_a.name).toBe("release_a");
      expect(Object.keys(flags)).toEqual(["release_a", "release_b"]);
      expect(Object.isFrozen(flags.release_b)).toBe(true);
    });
  });
});
