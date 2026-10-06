/**
 * The approval stream's subscription gap: pub/sub keeps no history, so the
 * stream re-reads the code once its channel is live and hears everything after.
 * @see specs/ai-gateway/governance/cli-login.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryCliDeviceSettlementChannel } from "../../channels/memory/memory.cli-device-settlement.channel.ts";
import { CliDeviceApprovalService } from "../cli-device-approval.service.ts";
import type {
  CliDeviceCodeRecord,
  CliDeviceSessionService,
} from "../cli-device-session.service.ts";

const DEVICE_CODE = "device-code-1";

function codeWith(status: string): CliDeviceCodeRecord {
  return {
    device_code: DEVICE_CODE,
    status,
    expires_at: Date.now() + 60_000,
  } as CliDeviceCodeRecord;
}

/** A session store holding `stored`, over the real memory settlement channel. */
function approvalOver({
  channel,
  stored,
  beforeSubscribing = async () => undefined,
}: {
  channel: MemoryCliDeviceSettlementChannel;
  stored: { current: CliDeviceCodeRecord };
  beforeSubscribing?: () => Promise<void>;
}) {
  let live: () => void = () => undefined;
  const subscribed = new Promise<void>((resolve) => {
    live = resolve;
  });
  const sessions = createApiFixture<CliDeviceSessionService>({
    getDeviceCode: async () => stored.current,
    listenForSettlement: async (input) => {
      await beforeSubscribing();
      const release = await channel.listen(input);
      live();
      return release;
    },
  });
  return { service: CliDeviceApprovalService.create({ sessions: () => sessions }), subscribed };
}

describe("given a device code that settles before the approval stream subscribes", () => {
  /** @scenario A publication is lost if the stream has not subscribed yet */
  it("is never heard by the late subscriber, and the stream's re-read still reports it", async () => {
    const channel = MemoryCliDeviceSettlementChannel.create();
    const stored = { current: codeWith("pending") };
    const heardByALateListener: string[] = [];
    const { service } = approvalOver({
      channel,
      stored,
      beforeSubscribing: async () => {
        stored.current = codeWith("approved");
        await channel.publish({ deviceCode: DEVICE_CODE, status: "approved" });
        const release = await channel.listen({
          deviceCode: DEVICE_CODE,
          onSettled: (status) => heardByALateListener.push(status),
        });
        release();
      },
    });

    const frames = await service.watch({ deviceCode: DEVICE_CODE, signal: undefined });
    const first = await frames[Symbol.asyncIterator]().next();

    expect(heardByALateListener).toEqual([]);
    expect(first.value).toEqual({ data: JSON.stringify({ status: "approved" }) });
  });

  describe("and another code settles once the channel is live", () => {
    /** @scenario A publication is lost if the stream has not subscribed yet */
    it("hears that settlement, so the re-read covers the whole gap", async () => {
      const channel = MemoryCliDeviceSettlementChannel.create();
      const stored = { current: codeWith("pending") };
      const { service, subscribed } = approvalOver({ channel, stored });

      const frames = await service.watch({ deviceCode: DEVICE_CODE, signal: undefined });
      const next = frames[Symbol.asyncIterator]().next();
      await subscribed;
      await channel.publish({ deviceCode: DEVICE_CODE, status: "denied" });

      await expect(next).resolves.toMatchObject({
        value: { data: JSON.stringify({ status: "denied" }) },
      });
    });
  });
});
