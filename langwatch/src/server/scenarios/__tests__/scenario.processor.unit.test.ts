/**
 * Unit tests for scenario processor.
 * @see specs/scenarios/simulation-runner.feature "Pass labels to SDK for tracing"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOtelResourceAttributes,
  handleCancelledJobResult,
  handleFailedJobResult,
  parseChildProcessResult,
  type ProcessorDependencies,
} from "../scenario.processor";
import type { ExecutionJobData } from "../execution/execution-pool";

describe("parseChildProcessResult", () => {
  it("extracts the result line from stdout mixed with pino logs", () => {
    const stdout = [
      '{"level":30,"time":1,"msg":"spawning"}',
      '{"level":50,"time":2,"err":"boom","msg":"scenario execution failed"}',
      '{"success":false,"error":"self-signed certificate in certificate chain"}',
    ].join("\n");
    expect(parseChildProcessResult(stdout)).toEqual({
      success: false,
      error: "self-signed certificate in certificate chain",
    });
  });

  it("returns the last result line and its reasoning on success", () => {
    const stdout =
      '{"level":30,"msg":"hi"}\n{"success":true,"reasoning":"looks good"}\n';
    expect(parseChildProcessResult(stdout)).toEqual({
      success: true,
      reasoning: "looks good",
    });
  });

  it("returns null when no result line is present", () => {
    expect(parseChildProcessResult('{"level":30,"msg":"only logs"}')).toBeNull();
    expect(parseChildProcessResult("")).toBeNull();
    expect(parseChildProcessResult("not json at all")).toBeNull();
  });
});

describe("buildOtelResourceAttributes", () => {
  it("always includes langwatch.origin.source=platform", () => {
    expect(buildOtelResourceAttributes([])).toBe(
      "langwatch.origin.source=platform",
    );
  });

  it("formats single label as OTEL resource attribute with source", () => {
    expect(buildOtelResourceAttributes(["support"])).toBe(
      "langwatch.origin.source=platform,scenario.labels=support",
    );
  });

  it("formats multiple labels as comma-separated OTEL resource attribute", () => {
    expect(buildOtelResourceAttributes(["support", "billing"])).toBe(
      "langwatch.origin.source=platform,scenario.labels=support,billing",
    );
  });

  it("escapes commas in label values", () => {
    expect(buildOtelResourceAttributes(["support,tier1"])).toBe(
      "langwatch.origin.source=platform,scenario.labels=support\\,tier1",
    );
  });

  it("escapes equals signs in label values", () => {
    expect(buildOtelResourceAttributes(["priority=high"])).toBe(
      "langwatch.origin.source=platform,scenario.labels=priority\\=high",
    );
  });
});

describe("handleCancelledJobResult", () => {
  let mockDeps: ProcessorDependencies;
  const baseJobData: ExecutionJobData = {
    projectId: "proj_123",
    scenarioId: "scen_456",
    setId: "set_789",
    batchRunId: "batch_abc",
    scenarioRunId: "run_001",
    target: { type: "prompt", referenceId: "ref_1" },
  };

  beforeEach(() => {
    mockDeps = {
      scenarioLookup: {
        getById: vi.fn().mockResolvedValue({ name: "Test Scenario", situation: "A test" }),
      },
      failureEmitter: {
        ensureFailureEventsEmitted: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  it("passes cancelled: true to failure emitter", async () => {
    await handleCancelledJobResult(baseJobData, "Job was cancelled", mockDeps);

    expect(mockDeps.failureEmitter.ensureFailureEventsEmitted).toHaveBeenCalledWith(
      expect.objectContaining({ cancelled: true }),
    );
  });

  it("includes scenario name and description from lookup", async () => {
    await handleCancelledJobResult(baseJobData, "Job was cancelled", mockDeps);

    expect(mockDeps.failureEmitter.ensureFailureEventsEmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test Scenario",
        description: "A test",
      }),
    );
  });

  it("defaults error message to 'Cancelled by user' when none provided", async () => {
    await handleCancelledJobResult(baseJobData, undefined, mockDeps);

    expect(mockDeps.failureEmitter.ensureFailureEventsEmitted).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Cancelled by user" }),
    );
  });
});

describe("handleFailedJobResult", () => {
  let mockDeps: ProcessorDependencies;
  const baseJobData: ExecutionJobData = {
    projectId: "proj_123",
    scenarioId: "scen_456",
    setId: "set_789",
    batchRunId: "batch_abc",
    scenarioRunId: "run_001",
    target: { type: "prompt", referenceId: "ref_1" },
  };

  beforeEach(() => {
    mockDeps = {
      scenarioLookup: {
        getById: vi.fn().mockResolvedValue({ name: "Test Scenario", situation: "A test" }),
      },
      failureEmitter: {
        ensureFailureEventsEmitted: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  it("does not pass cancelled flag to failure emitter", async () => {
    await handleFailedJobResult(baseJobData, "Child process exited", mockDeps);

    const params = (mockDeps.failureEmitter.ensureFailureEventsEmitted as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(params.cancelled).toBeUndefined();
  });
});
