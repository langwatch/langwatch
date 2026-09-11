/**
 * @vitest-environment node
 *
 * The environment handed to the scenario child process.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildChildEnvironment,
  buildChildProcessEnv,
} from "../execution/child-environment";
import type { ExecutionJobData } from "../execution/execution-pool";

// child-environment reads `env` at module load; stub it so this node test needs
// no real environment validation.
vi.mock("~/env.mjs", () => ({
  env: { IS_SAAS: false },
}));

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
        expect(buildChildProcessEnv({}).NODE_COMPILE_CACHE).toBe(
          "/somewhere/else",
        );
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

    it("forwards the platform's fetch ceiling so the adapter in the child can read it", () => {
      // This allowlist is the only route from the operator's environment into
      // the child; without the entry NLP_FETCH_MAX_TIMEOUT_MS is settable but
      // never observed, and the adapter silently keeps its 15-minute default.
      const previous = process.env.NLP_FETCH_MAX_TIMEOUT_MS;
      process.env.NLP_FETCH_MAX_TIMEOUT_MS = "1800000";
      try {
        expect(buildChildProcessEnv({}).NLP_FETCH_MAX_TIMEOUT_MS).toBe(
          "1800000",
        );
      } finally {
        if (previous === undefined) {
          delete process.env.NLP_FETCH_MAX_TIMEOUT_MS;
        } else {
          process.env.NLP_FETCH_MAX_TIMEOUT_MS = previous;
        }
      }
    });

    it("forwards the nlpgo engine's own ceiling so the client deadline can derive from it", () => {
      // The adapters in the child derive their fetch deadline from this
      // exact env var name (`resolveFloorFetchTimeoutMs` in
      // `../../nlpgo/timeouts.ts`), the same one nlpgo itself reads.
      // Without this entry the client deadline could silently drift below
      // the engine's ceiling again — the production bug this fixes.
      const previous = process.env.NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS;
      process.env.NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS = "900";
      try {
        expect(
          buildChildProcessEnv({}).NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS,
        ).toBe("900");
      } finally {
        if (previous === undefined) {
          delete process.env.NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS;
        } else {
          process.env.NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS = previous;
        }
      }
    });

    it("drops variables with no value rather than passing them as undefined", () => {
      const env = buildChildProcessEnv({ SOME_UNSET_VAR: undefined });

      expect("SOME_UNSET_VAR" in env).toBe(false);
    });
  });
});

describe("buildChildEnvironment", () => {
  const jobData: ExecutionJobData = {
    projectId: "proj_1",
    scenarioId: "scen_1",
    scenarioRunId: "run_1",
    batchRunId: "batch_1",
    setId: "set_1",
    target: { type: "voice", referenceId: "agent_1" },
  };
  const telemetry = { endpoint: "http://app:5560", apiKey: "lw-key" };

  describe("given a voice run with caller env keys", () => {
    /** @scenario The caller voice keys reach the child env only for a voice target */
    it("merges the caller OpenAI key into the child env", () => {
      const env = buildChildEnvironment({
        jobData,
        labels: [],
        telemetry,
        callerEnv: { OPENAI_API_KEY: "sk-openai" },
      });

      expect(env.OPENAI_API_KEY).toBe("sk-openai");
    });
  });

  describe("given a non-voice run with a non-empty caller env", () => {
    /** @scenario The caller voice keys reach the child env only for a voice target */
    it("excludes the caller's keys from the child env", () => {
      const httpJobData: ExecutionJobData = {
        ...jobData,
        target: { type: "http", referenceId: "agent_1" },
      };
      const env = buildChildEnvironment({
        jobData: httpJobData,
        labels: [],
        telemetry,
        callerEnv: { OPENAI_API_KEY: "sk-openai" },
      });

      expect("OPENAI_API_KEY" in env).toBe(false);
    });
  });
});
