import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDeprecationWarnings, warnOnceIfDeprecated } from "../deprecation-warning";

const deprecated = new Response(null, { headers: { Deprecation: "true" } });

describe("warnOnceIfDeprecated()", () => {
  beforeEach(() => {
    resetDeprecationWarnings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("when the response is deprecated", () => {
    it("writes to stderr once per message", () => {
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      warnOnceIfDeprecated({ response: deprecated, message: "old route" });
      warnOnceIfDeprecated({ response: deprecated, message: "old route" });

      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stderr).toHaveBeenCalledWith("old route\n");
    });
  });

  describe("when the response is not deprecated", () => {
    it("writes nothing", () => {
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      warnOnceIfDeprecated({ response: new Response(null), message: "old route" });

      expect(stderr).not.toHaveBeenCalled();
    });
  });

  describe("when the runtime has no process", () => {
    it("falls back to console.warn instead of throwing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.stubGlobal("process", undefined);

      expect(() =>
        warnOnceIfDeprecated({ response: deprecated, message: "old route" }),
      ).not.toThrow();

      expect(warn).toHaveBeenCalledWith("old route");
    });
  });
});
