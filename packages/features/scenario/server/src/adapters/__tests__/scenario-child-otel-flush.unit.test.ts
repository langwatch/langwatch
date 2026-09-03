/**
 * @vitest-environment node
 *
 * The child's last act. A simulation child is a short-lived process, so
 * anything still sitting in the span exporter's queue when it exits is lost —
 * the run looks untraced. This drives the flush the child performs before it
 * returns its result.
 */
import type { Logger } from "@langwatch/observability";
import { trace } from "@opentelemetry/api";
import type { TracerProvider } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushScenarioOtelTraces } from "../scenario-child-execution.adapter";

function silentLogger(): Logger {
  const warnings: unknown[] = [];

  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (...args: unknown[]) => {
      warnings.push(args);
    },
    error: () => undefined,
    warnings,
  } as unknown as Logger & { warnings: unknown[] };
}

function useProvider(provider: object): void {
  vi.spyOn(trace, "getTracerProvider").mockReturnValue(provider as TracerProvider);
}

describe("flushScenarioOtelTraces()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given a provider that can force a flush", () => {
    describe("when the child finishes its run", () => {
      /** @scenario "Child telemetry is flushed before exit" */
      it("waits for the flush rather than shutting the provider down", async () => {
        const calls: string[] = [];
        useProvider({
          forceFlush: async () => {
            calls.push("forceFlush");
          },
          shutdown: async () => {
            calls.push("shutdown");
          },
        });

        await flushScenarioOtelTraces(silentLogger());

        expect(calls).toEqual(["forceFlush"]);
      });
    });
  });

  describe("given a provider that offers only a shutdown", () => {
    describe("when the child finishes its run", () => {
      /** @scenario "Child telemetry is flushed before exit" */
      it("shuts it down so the queued spans still leave the process", async () => {
        const calls: string[] = [];
        useProvider({
          shutdown: async () => {
            calls.push("shutdown");
          },
        });

        await flushScenarioOtelTraces(silentLogger());

        expect(calls).toEqual(["shutdown"]);
      });
    });
  });

  describe("given a proxy provider wrapping the real one", () => {
    describe("when the child finishes its run", () => {
      /** @scenario "Child telemetry is flushed before exit" */
      it("flushes the delegate, not the proxy", async () => {
        const calls: string[] = [];
        const delegate = {
          forceFlush: async () => {
            calls.push("delegate.forceFlush");
          },
        };
        useProvider({ getDelegate: () => delegate });

        await flushScenarioOtelTraces(silentLogger());

        expect(calls).toEqual(["delegate.forceFlush"]);
      });
    });
  });

  describe("given a provider whose flush fails", () => {
    describe("when the child finishes its run", () => {
      /** @scenario "Child telemetry is flushed before exit" */
      it("does not fail the simulation over lost telemetry", async () => {
        useProvider({
          forceFlush: async () => {
            throw new Error("collector unreachable");
          },
        });

        await expect(flushScenarioOtelTraces(silentLogger())).resolves.toBeUndefined();
      });
    });
  });
});
