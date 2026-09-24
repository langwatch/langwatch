/** Spec: specs/lwql/access-model.feature */
import { describe, expect, it, vi } from "vitest";

import type { LwqlAccessModelOwner } from "../../rules/langwatch-ql-config-store.rules.ts";
import {
  LWQL_RECONVERGENCE_PROCESS_NAME,
  runLwqlReconvergence,
} from "../analytics-lwql-reconvergence.intent.ts";
import {
  LWQL_RECONVERGENCE_BUDGET_MS,
  LWQL_RECONVERGENCE_INITIAL_DELAY_MS,
  LWQL_RECONVERGENCE_INITIAL_STATE,
  LWQL_RECONVERGENCE_MAX_DELAY_MS,
  type LwqlReconvergenceState,
  lwqlReconvergenceWake,
} from "../analytics-lwql-reconvergence.process.ts";

const BOOTED_AT = 1_700_000_000_000;

function wake(state: LwqlReconvergenceState, at: number) {
  const reconverge = vi.fn((messageKey: string, payload: { scheduledFor: number }) => ({
    messageKey,
    intentType: "reconverge",
    payload,
  }));
  const evolution = lwqlReconvergenceWake({ bootedAt: BOOTED_AT })(state, {
    at,
    now: at,
    key: LWQL_RECONVERGENCE_PROCESS_NAME,
    projectId: "__global__",
    intents: { reconverge },
  });
  return { evolution, reconverge };
}

describe("given the access-model reconvergence watch", () => {
  describe("when the process has just come up", () => {
    it("probes first after the initial delay, then backs off to the cap", () => {
      const early = wake(LWQL_RECONVERGENCE_INITIAL_STATE, BOOTED_AT + 1_000);
      expect(early.reconverge).not.toHaveBeenCalled();

      let state = early.evolution.state;
      let at = BOOTED_AT + LWQL_RECONVERGENCE_INITIAL_DELAY_MS;
      const delays: number[] = [];
      for (let i = 0; i < 8; i++) {
        const next = wake(state, at);
        expect(next.reconverge).toHaveBeenCalledTimes(1);
        state = next.evolution.state;
        delays.push(state.delayMs);
        at = state.nextAt;
      }
      expect(delays.at(-1)).toBe(LWQL_RECONVERGENCE_MAX_DELAY_MS);
    });

    it("gives up once the budget would be exceeded", () => {
      let state = wake(LWQL_RECONVERGENCE_INITIAL_STATE, BOOTED_AT).evolution.state;
      let at = state.nextAt;
      let probes = 0;
      while (!state.gaveUp) {
        const next = wake(state, at);
        probes += next.reconverge.mock.calls.length;
        state = next.evolution.state;
        at = state.nextAt;
      }
      expect(state.elapsedMs).toBeLessThanOrEqual(LWQL_RECONVERGENCE_BUDGET_MS);
      expect(wake(state, at + LWQL_RECONVERGENCE_BUDGET_MS).reconverge).not.toHaveBeenCalled();
      expect(probes).toBeGreaterThan(0);
    });
  });

  describe("when a probe answers", () => {
    const run = (owner: LwqlAccessModelOwner | Error) => {
      const converge = vi.fn(() => Promise.resolve());
      const probe = () => (owner instanceof Error ? Promise.reject(owner) : Promise.resolve(owner));
      return { converge, done: runLwqlReconvergence({ probe, converge })({ final: false }) };
    };

    /** @scenario "The app re-provisions once the ClickHouse config store releases the LangWatchQL access model" */
    it("re-provisions only once neither store owns the model", async () => {
      for (const owner of ["config_store", "sql_store"] as const) {
        const { converge, done } = run(owner);
        await done;
        expect(converge).not.toHaveBeenCalled();
      }
      const released = run("none");
      await released.done;
      expect(released.converge).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A re-provision in flight finishes before the worker lets the app close" */
    it("resolves only once the re-provision has finished", async () => {
      const order: string[] = [];
      const converge = () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push("converged");
            resolve();
          }, 5);
        });
      await runLwqlReconvergence({ probe: () => Promise.resolve("none"), converge })({
        final: false,
      });
      order.push("intent resolved");
      expect(order).toEqual(["converged", "intent resolved"]);
    });

    it("keeps waiting when ClickHouse cannot be read", async () => {
      const { converge, done } = run(new Error("ECONNREFUSED"));
      await done;
      expect(converge).not.toHaveBeenCalled();
    });
  });
});
