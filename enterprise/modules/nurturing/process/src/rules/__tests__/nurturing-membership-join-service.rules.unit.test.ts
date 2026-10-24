/**
 * What an SSO auto-add tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fireSsoAutoAdded } from "../nurturing-membership-join-service.rules.ts";

afterEach(() => vi.useRealTimers());

describe("fireSsoAutoAdded", () => {
  describe("given a person added by the SSO domain match", () => {
    describe("when the join is identified", () => {
      /** @scenario "Customer.io date attributes are sent as Unix seconds" */
      it("decides to send createdAt as whole Unix seconds", () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_792_664_000_123);

        const calls = fireSsoAutoAdded({
          signal: {
            kind: "sso_auto_added",
            sourceEventId: "event-1",
            tenantId: "org-1",
            occurredAt: 1_792_664_000_123,
            userId: "user-1",
            organizationId: "org-1",
            organizationName: "Acme Corp",
          },
        });

        expect(calls[0]).toMatchObject({ traits: { createdAt: 1_792_664_000 } });
      });
    });
  });
});
