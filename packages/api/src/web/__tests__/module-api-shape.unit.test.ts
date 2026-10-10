/**
 * Pins the RUNTIME shape of a module api client, because it is surprising and
 * a reasonable-looking tidy-up breaks the shell's mount check.
 * Spec: specs/ui/module-api-mounting.feature
 */
import { describe, expect, it } from "vitest";

import { createModuleApi } from "../module-api.ts";

describe("createModuleApi", () => {
  describe("given the client the shell has to recognise before mounting it", () => {
    /** @scenario "A module api client reports as a function, not an object" */
    it("reports as a function and owns no keys, while still carrying a Provider", () => {
      const api = createModuleApi<Record<never, never>>();

      // A tRPC proxy traps neither `has` nor ownKeys, so the two obvious
      // predicates BOTH answer no while `.Provider` is a real component.
      expect(typeof api).toBe("function");
      expect("Provider" in api).toBe(false);
      expect(Object.keys(api)).toEqual([]);

      expect(typeof api.Provider).toBe("function");
    });
  });
});
