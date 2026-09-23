import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { HostedSpendRecorder } from "../../app/licensing.members.ts";
import { ConnectSpendBufferService } from "../connect-spend-buffer.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

type Written = Parameters<HostedSpendRecorder["recordSpend"]>[0];

class RecordingRecorder implements HostedSpendRecorder {
  readonly written: Written[] = [];
  refusing = false;

  async recordSpend(entry: Written): Promise<void> {
    if (this.refusing) throw new Error("the spend pipeline is not accepting writes");
    this.written.push(entry);
  }
}

function buffer(recorder: HostedSpendRecorder) {
  return ConnectSpendBufferService.create({
    recorder,
    flushIntervalMs: 60_000,
    now: () => NOW,
  });
}

describe("ConnectSpendBufferService", () => {
  /** @scenario "Many classify calls are metered as one spend row per license" */
  it("writes one record per key carrying the summed tokens, cost and call count", async () => {
    const recorder = new RecordingRecorder();
    const spend = buffer(recorder);

    for (let call = 0; call < 3; call += 1) {
      spend.add({
        virtualKeyId: "vk-managed",
        projectId: "project-hidden",
        inputTokens: 1_000,
        costUsd: 0.1,
        priceUsd: 0.13,
      });
    }
    await spend.flush();

    expect(recorder.written).toEqual([
      {
        projectId: "project-hidden",
        virtualKeyId: "vk-managed",
        inputTokens: 3_000,
        requests: 3,
        costUsd: 0.30000000000000004,
        priceUsd: 0.39,
        occurredAt: NOW,
      },
    ]);
  });

  it("keeps one key's spend apart from another's", async () => {
    const recorder = new RecordingRecorder();
    const spend = buffer(recorder);

    spend.add({
      virtualKeyId: "vk-a",
      projectId: "p1",
      inputTokens: 10,
      costUsd: 1,
      priceUsd: 2,
    });
    spend.add({
      virtualKeyId: "vk-b",
      projectId: "p2",
      inputTokens: 20,
      costUsd: 3,
      priceUsd: 4,
    });
    await spend.flush();

    expect(recorder.written.map((row) => row.virtualKeyId).toSorted()).toEqual(["vk-a", "vk-b"]);
  });

  it("meters nothing for a call that billed no tokens", async () => {
    const recorder = new RecordingRecorder();
    const spend = buffer(recorder);

    spend.add({
      virtualKeyId: "vk-managed",
      projectId: "p1",
      inputTokens: 0,
      costUsd: 0,
      priceUsd: 0,
    });
    await spend.flush();

    expect(recorder.written).toEqual([]);
  });

  /** @scenario "Spend that could not be written is kept and written later" */
  it("keeps spend the pipeline refused and writes it once it accepts again", async () => {
    const recorder = new RecordingRecorder();
    const spend = buffer(recorder);
    recorder.refusing = true;

    spend.add({
      virtualKeyId: "vk-managed",
      projectId: "p1",
      inputTokens: 1_000,
      costUsd: 0.1,
      priceUsd: 0.13,
    });
    await spend.flush();
    expect(recorder.written).toEqual([]);

    recorder.refusing = false;
    await spend.flush();

    expect(recorder.written).toMatchObject([{ inputTokens: 1_000, requests: 1 }]);
  });

  it("writes before the interval once one key has made enough calls", async () => {
    const recorder = new RecordingRecorder();
    const spend = ConnectSpendBufferService.create({
      recorder,
      flushIntervalMs: 60_000,
      maxRequestsPerKey: 2,
      now: () => NOW,
    });

    spend.add({ virtualKeyId: "vk", projectId: "p", inputTokens: 1, costUsd: 0, priceUsd: 0 });
    spend.add({ virtualKeyId: "vk", projectId: "p", inputTokens: 1, costUsd: 0, priceUsd: 0 });
    await Promise.resolve();

    expect(recorder.written).toMatchObject([{ requests: 2 }]);
  });
});
