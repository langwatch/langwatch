/**
 * Unit tests for evaluations scheduling with thread debouncing.
 *
 * These tests verify that:
 * 1. threadIdleTimeout is correctly read from monitor configuration
 * 2. threadDebounce is passed to scheduleEvaluation when appropriate
 * 3. threadDebounce is NOT passed for trace-level evaluations
 */
import { EvaluationExecutionMode } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../../db";
import { scheduleEvaluations } from "../evaluations";
import type { EvaluationJob } from "../../../types";
import type { PreconditionTrace } from "../../../../evaluations/preconditions";
import type { Span } from "../../../../tracer/types";

// Mock the scheduleEvaluation function to capture calls
const mockScheduleEvaluation = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../queues/evaluationsQueue", () => ({
  scheduleEvaluation: (...args: any[]) => mockScheduleEvaluation(...args),
}));

describe("scheduleEvaluations - thread idle timeout", () => {
  const projectId = `test-project-${nanoid()}`;
  const testMonitorIds: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up monitors created in tests
    for (const monitorId of testMonitorIds) {
      await prisma.monitor.delete({ where: { id: monitorId, projectId } }).catch(() => {});
    }
    testMonitorIds.length = 0;
  });

  afterAll(async () => {
    // Final cleanup
    await prisma.monitor.deleteMany({ where: { projectId } }).catch(() => {});
  });

  const createTestTrace = (threadId?: string): EvaluationJob["trace"] & PreconditionTrace => ({
    trace_id: `trace-${nanoid()}`,
    project_id: projectId,
    thread_id: threadId,
    user_id: undefined,
    customer_id: undefined,
    labels: undefined,
    input: { value: "test input" },
    output: { value: "test output" },
    metadata: threadId ? { thread_id: threadId } : {},
  });

  const createTestSpans = (): Span[] => [];

  it("passes threadDebounce when monitor has threadIdleTimeout and trace has thread_id", async () => {
    // Create monitor with threadIdleTimeout
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Thread Monitor",
        slug: `thread-monitor-${nanoid()}`,
        checkType: "presidio/pii_detection",
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        enabled: true,
        preconditions: [],
        parameters: {},
        sample: 1.0,
        threadIdleTimeout: 300, // 5 minutes
      },
    });
    testMonitorIds.push(monitor.id);

    const threadId = `thread-${nanoid()}`;
    const trace = createTestTrace(threadId);
    const spans = createTestSpans();

    await scheduleEvaluations(trace, spans);

    expect(mockScheduleEvaluation).toHaveBeenCalledTimes(1);
    expect(mockScheduleEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        threadDebounce: {
          threadId,
          timeoutSeconds: 300,
        },
      })
    );
  });

  it("does not pass threadDebounce when monitor has no threadIdleTimeout", async () => {
    // Create monitor without threadIdleTimeout
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Trace Monitor",
        slug: `trace-monitor-${nanoid()}`,
        checkType: "presidio/pii_detection",
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        enabled: true,
        preconditions: [],
        parameters: {},
        sample: 1.0,
        threadIdleTimeout: null, // No timeout
      },
    });
    testMonitorIds.push(monitor.id);

    const threadId = `thread-${nanoid()}`;
    const trace = createTestTrace(threadId);
    const spans = createTestSpans();

    await scheduleEvaluations(trace, spans);

    expect(mockScheduleEvaluation).toHaveBeenCalledTimes(1);
    expect(mockScheduleEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        threadDebounce: undefined,
      })
    );
  });

  it("does not pass threadDebounce when trace has no thread_id", async () => {
    // Create monitor with threadIdleTimeout but trace without thread_id
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Thread Monitor No ID",
        slug: `thread-monitor-no-id-${nanoid()}`,
        checkType: "presidio/pii_detection",
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        enabled: true,
        preconditions: [],
        parameters: {},
        sample: 1.0,
        threadIdleTimeout: 300,
      },
    });
    testMonitorIds.push(monitor.id);

    // Trace without thread_id
    const trace = createTestTrace(undefined);
    const spans = createTestSpans();

    await scheduleEvaluations(trace, spans);

    expect(mockScheduleEvaluation).toHaveBeenCalledTimes(1);
    expect(mockScheduleEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        threadDebounce: undefined,
      })
    );
  });

  it("reads thread_id from trace.metadata when trace.thread_id is not set", async () => {
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Thread Monitor Metadata",
        slug: `thread-monitor-metadata-${nanoid()}`,
        checkType: "presidio/pii_detection",
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        enabled: true,
        preconditions: [],
        parameters: {},
        sample: 1.0,
        threadIdleTimeout: 600, // 10 minutes
      },
    });
    testMonitorIds.push(monitor.id);

    const threadId = `thread-from-metadata-${nanoid()}`;
    // Create trace with thread_id only in metadata
    const trace: EvaluationJob["trace"] & PreconditionTrace = {
      trace_id: `trace-${nanoid()}`,
      project_id: projectId,
      thread_id: undefined, // Not set directly
      user_id: undefined,
      customer_id: undefined,
      labels: undefined,
      input: { value: "test input" },
      output: { value: "test output" },
      metadata: { thread_id: threadId }, // Set in metadata
    };
    const spans = createTestSpans();

    await scheduleEvaluations(trace, spans);

    expect(mockScheduleEvaluation).toHaveBeenCalledTimes(1);
    expect(mockScheduleEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        threadDebounce: {
          threadId,
          timeoutSeconds: 600,
        },
      })
    );
  });

  it("uses different timeout values correctly", async () => {
    // Create monitors with different timeout values
    const monitors = await Promise.all([
      prisma.monitor.create({
        data: {
          id: `monitor_60_${nanoid()}`,
          projectId,
          name: "1 Minute Monitor",
          slug: `monitor-60-${nanoid()}`,
          checkType: "presidio/pii_detection",
          executionMode: EvaluationExecutionMode.ON_MESSAGE,
          enabled: true,
          preconditions: [],
          parameters: {},
          sample: 1.0,
          threadIdleTimeout: 60, // 1 minute
        },
      }),
      prisma.monitor.create({
        data: {
          id: `monitor_1800_${nanoid()}`,
          projectId,
          name: "30 Minute Monitor",
          slug: `monitor-1800-${nanoid()}`,
          checkType: "langevals/exact_match",
          executionMode: EvaluationExecutionMode.ON_MESSAGE,
          enabled: true,
          preconditions: [],
          parameters: {},
          sample: 1.0,
          threadIdleTimeout: 1800, // 30 minutes
        },
      }),
    ]);
    testMonitorIds.push(...monitors.map(m => m.id));

    const threadId = `thread-${nanoid()}`;
    const trace = createTestTrace(threadId);
    const spans = createTestSpans();

    await scheduleEvaluations(trace, spans);

    expect(mockScheduleEvaluation).toHaveBeenCalledTimes(2);

    // Check that both monitors were scheduled with their respective timeouts
    const calls = mockScheduleEvaluation.mock.calls;
    const timeouts = calls.map((call: any[]) => call[0].threadDebounce?.timeoutSeconds).sort();
    expect(timeouts).toEqual([60, 1800]);
  });
});
