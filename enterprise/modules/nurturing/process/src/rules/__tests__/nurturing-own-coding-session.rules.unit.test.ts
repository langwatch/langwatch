// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/coding-agent-signals.feature
 */
import type { CodingAgentSessionStoredEventData } from "@langwatch/coding-agent-contract";
import type { NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import { describe, expect, it } from "vitest";

import {
  fireOwnCodingFirstSession,
  fireOwnCodingLastSession,
} from "../nurturing-coding-delivery.rules.ts";
import {
  ownCodingSessionRecipients,
  ownCodingSessionStoredSignal,
} from "../nurturing-coding-signals.rules.ts";
import {
  ownCodingFirstSessionClaim,
  pickCustomerIoDebounce,
} from "../nurturing-delivery-debounce.rules.ts";
import { isMemberFact } from "../nurturing-member-facts.rules.ts";

const T0 = Date.UTC(2026, 9, 20, 12);

const fact = (over: Partial<CodingAgentSessionStoredEventData> = {}) => ({
  tenantId: "project-1",
  projectId: "project-1",
  sessionId: "session-1",
  agentType: "claude_code",
  firstForProject: false,
  occurredAt: T0,
  ...over,
});

const own = (
  userId: string,
  tenantId = "project-1",
): NurturingSignalOf<"own_coding_session_stored"> =>
  ownCodingSessionStoredSignal({
    latest: fact({ tenantId, projectId: tenantId, occurredAt: T0 + 1_000 }),
    earliest: fact({ tenantId, projectId: tenantId }),
    userId,
  });

describe("ownCodingSessionRecipients", () => {
  /** @scenario "A personal project's session tells only its owner own_coding_last_session_at" */
  it("names the personal project's owner and no other member", () => {
    expect(
      ownCodingSessionRecipients({
        personalOwnerUserIds: ["owner-1"],
        activeMemberUserIds: ["owner-1", "member-2"],
      }),
    ).toEqual(["owner-1"]);
  });

  /** @scenario "A shared project's session sets no own coding trait" */
  it("names no one for a shared project", () => {
    expect(
      ownCodingSessionRecipients({
        personalOwnerUserIds: [],
        activeMemberUserIds: ["owner-1", "member-2"],
      }),
    ).toEqual([]);
  });

  /** @scenario "A deactivated owner gets no own coding trait" */
  it("names no one when the owner is not an active member", () => {
    expect(
      ownCodingSessionRecipients({
        personalOwnerUserIds: ["owner-1"],
        activeMemberUserIds: ["member-2"],
      }),
    ).toEqual([]);
  });
});

describe("ownCodingSessionStoredSignal", () => {
  it("carries the latest session's time and the batch's earliest", () => {
    expect(own("owner-1")).toMatchObject({
      kind: "own_coding_session_stored",
      userId: "owner-1",
      occurredAt: T0 + 1_000,
      firstOccurredAt: T0,
    });
  });

  it("is no organization fact, so other members never hear it", () => {
    expect(isMemberFact(own("owner-1"))).toBe(false);
  });
});

describe("own coding session delivery rules", () => {
  /** @scenario "Own session updates are debounced per person for 300 seconds" */
  it("debounces per person for 300 seconds, whichever project the session came from", () => {
    expect(pickCustomerIoDebounce(own("owner-1", "project-1"))).toEqual({
      seconds: 300,
      claimKey: "nurturing:cio-sync-person:own_coding_session_stored:owner-1",
    });
    expect(pickCustomerIoDebounce(own("owner-1", "project-2"))).toEqual(
      pickCustomerIoDebounce(own("owner-1", "project-1")),
    );
    expect(pickCustomerIoDebounce(own("owner-2"))?.claimKey).not.toBe(
      pickCustomerIoDebounce(own("owner-1"))?.claimKey,
    );
  });

  /** @scenario "A person's own first session is set once across organizations" */
  it("claims the first session on the person alone", () => {
    expect(ownCodingFirstSessionClaim(own("owner-1", "project-1")).claimKey).toBe(
      "nurturing:own_coding_first_session:owner-1",
    );
    expect(ownCodingFirstSessionClaim(own("owner-1", "project-2")).claimKey).toBe(
      "nurturing:own_coding_first_session:owner-1",
    );
  });

  it("identifies the owner with their own times in Unix seconds", () => {
    const signal = own("owner-1");
    expect(fireOwnCodingLastSession(signal)).toEqual([
      {
        type: "identify",
        userId: "owner-1",
        traits: { own_coding_last_session_at: Math.floor((T0 + 1_000) / 1000) },
      },
    ]);
    expect(fireOwnCodingFirstSession(signal)).toEqual([
      {
        type: "identify",
        userId: "owner-1",
        traits: { own_coding_first_session_at: Math.floor(T0 / 1000) },
      },
    ]);
  });
});
