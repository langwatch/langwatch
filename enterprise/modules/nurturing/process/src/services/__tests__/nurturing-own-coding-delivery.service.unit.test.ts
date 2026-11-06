// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/coding-agent-signals.feature
 */
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import { describe, expect, it } from "vitest";

import { CustomerIoChannel } from "../../channels/customer-io.channel.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { NurturingOwnCodingDeliveryService } from "../nurturing-own-coding-delivery.service.ts";
import { NurturingService } from "../nurturing.service.ts";

const T0 = Date.UTC(2026, 9, 20, 12);
const FIRST_CLAIM = "nurturing:own_coding_first_session:owner-1";

const ownSession: NurturingSignalOf<"own_coding_session_stored"> = {
  kind: "own_coding_session_stored",
  sourceEventId: `owner-1:project-1:${T0}`,
  tenantId: "project-1",
  userId: "owner-1",
  projectId: "project-1",
  occurredAt: T0,
  firstOccurredAt: T0,
};

/** A Customer.io channel whose batch rejects while `failing` is set. */
class FlakyChannel extends CustomerIoChannel {
  failing = true;
  readonly sent: CioBatchCall[] = [];
  async identifyUser(): Promise<void> {}
  async trackEvent(): Promise<void> {}
  async groupUser(): Promise<void> {}
  async batch(calls: CioBatchCall[]): Promise<void> {
    if (this.failing) throw new Error("Customer.io unavailable");
    this.sent.push(...calls);
  }
}

function deliveryOver() {
  const channel = new FlakyChannel();
  const claims = MemoryNurturingClaimRepository.create();
  const delivery = NurturingOwnCodingDeliveryService.create({
    claims,
    customerIo: NurturingService.create({ channel }),
  });
  return { channel, claims, delivery };
}

describe("NurturingOwnCodingDeliveryService", () => {
  describe("when the first-session send fails", () => {
    /** @scenario "A failed first-session send gives its claim back" */
    it("gives the person's first-session claim back", async () => {
      const { claims, delivery } = deliveryOver();

      await delivery.deliver(ownSession);

      expect(await claims.claim(FIRST_CLAIM, 60)).toBe(true);
    });

    it("sets own_coding_first_session_at on the person's next session", async () => {
      const { channel, delivery } = deliveryOver();

      await delivery.deliver(ownSession);
      channel.failing = false;
      await delivery.deliver({ ...ownSession, occurredAt: T0 + 1_000 });

      expect(channel.sent).toContainEqual({
        type: "identify",
        userId: "owner-1",
        traits: { own_coding_first_session_at: Math.floor(T0 / 1000) },
      });
    });
  });

  describe("when the first-session send succeeds", () => {
    it("keeps the claim, so a later session does not move the first", async () => {
      const { channel, claims, delivery } = deliveryOver();
      channel.failing = false;

      await delivery.deliver(ownSession);

      expect(await claims.claim(FIRST_CLAIM, 60)).toBe(false);
    });
  });
});
