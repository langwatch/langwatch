/**
 * A queued job whose pipeline this worker does not have registered (fleet mid-rollout scenario).
 * Spec: specs/ai-gateway/billing-spend-events.feature
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";

const TEST_PIPELINE_NAME = "gateway_spend_processing";

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }));

vi.mock("@langwatch/observability", () => {
  const createLogger = () => {
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: errorMock,
      fatal: vi.fn(),
      child: () => logger,
    };
    return logger;
  };
  return { createLogger };
});

/**
 * Test isolation is off: the module cache is shared across files, so an
 * earlier importer pins the real observability module and vi.mock cannot
 * replace it. The inline re-import below fetches a fresh copy.
 */
async function createEventSourcingWithMockedLogger() {
  vi.resetModules();
  const { EventSourcing } = await import("../../eventSourcing.ts");
  return new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
}

/** A confirm exactly as the ingest route hands it to the queue: priced, with
 *  the routing metadata that names the pipeline holding its handler. */
const confirmSpendJob = {
  __pipelineName: TEST_PIPELINE_NAME,
  __jobType: "command",
  __jobName: "confirmSpend",
  gateway_request_id: "req_unroutable_probe",
  tenantId: "project-unroutable",
  occurred_at: Date.UTC(2026, 6, 1),
  model: "gpt-5-mini",
  model_provider_id: "",
  usage: {
    input_tokens: 53,
    output_tokens: 20,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_tokens: 0,
    cache_creation_1h_tokens: 0,
    input_audio_tokens: 0,
    output_audio_tokens: 0,
    input_chars: 0,
    audio_ms: 0,
  },
  rate_version: "registry@2026-07-27",
  duration_ms: 1552,
  cost_nano_usd: 19950,
};

describe("a job whose pipeline is not registered in this worker", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /** @scenario A worker without the spend pipeline refuses the command instead of acknowledging it */
  it("rejects the spend command for retry and names the request at error level", async () => {
    // No pipeline is registered, which is what an older build looks like to a
    // command minted by a newer one.
    const eventSourcing = await createEventSourcingWithMockedLogger();

    await expect(eventSourcing.globalQueue!.send(confirmSpendJob)).rejects.toThrow(
      /not registered in this worker/,
    );

    expect(errorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineName: TEST_PIPELINE_NAME,
        jobType: "command",
        jobName: "confirmSpend",
        tenantId: "project-unroutable",
        gatewayRequestId: "req_unroutable_probe",
      }),
      "No handler registered for this job in this worker; rejecting it for retry rather than dropping it",
    );

    await eventSourcing.close();
  });

  it("keeps rejecting a job whose routing metadata is missing entirely", async () => {
    const eventSourcing = await createEventSourcingWithMockedLogger();

    await expect(
      eventSourcing.globalQueue!.send({
        gateway_request_id: "req_no_routing_metadata",
        tenantId: "project-unroutable",
      }),
    ).rejects.toThrow(/not registered in this worker/);

    await eventSourcing.close();
  });
});
