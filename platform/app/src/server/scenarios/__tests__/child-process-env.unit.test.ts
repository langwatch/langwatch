/**
 * @vitest-environment node
 *
 * The environment handed to the scenario child process.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import { describe, expect, it } from "vitest";
import { buildChildProcessEnv } from "../execution/child-environment";

describe("buildChildProcessEnv", () => {
  describe("given the scenario processor builds the child environment", () => {
    /** @scenario 'Repeat simulations do not repeat the same startup work' */
    it("names a compile cache directory, and keeps one the caller already set", () => {
      // The child is a fresh process per scenario run, so without a compile
      // cache it re-compiles the same bundle on every single run.
      const fresh = buildChildProcessEnv({});
      expect(fresh.NODE_COMPILE_CACHE).toBeTruthy();

      const previous = process.env.NODE_COMPILE_CACHE;
      process.env.NODE_COMPILE_CACHE = "/somewhere/else";
      try {
        expect(buildChildProcessEnv({}).NODE_COMPILE_CACHE).toBe("/somewhere/else");
      } finally {
        if (previous === undefined) {
          delete process.env.NODE_COMPILE_CACHE;
        } else {
          process.env.NODE_COMPILE_CACHE = previous;
        }
      }
    });

    /** @scenario 'Child process environment variables are preserved' */
    it("passes scenario variables through to the child", () => {
      const env = buildChildProcessEnv({
        LANGWATCH_API_KEY: "key-1",
        LANGWATCH_ENDPOINT: "http://localhost:9999",
      });

      expect(env.LANGWATCH_API_KEY).toBe("key-1");
      expect(env.LANGWATCH_ENDPOINT).toBe("http://localhost:9999");
    });

    it("drops variables with no value rather than passing them as undefined", () => {
      const env = buildChildProcessEnv({ SOME_UNSET_VAR: undefined });

      expect("SOME_UNSET_VAR" in env).toBe(false);
    });
  });
});
