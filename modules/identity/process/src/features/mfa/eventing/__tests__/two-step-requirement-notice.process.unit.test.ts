import { createTenantId, type ProcessHandlerContext } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
/**
 * @vitest-environment node
 * The requirement change told to members on the worker, from the recorded fact.
 * @see specs/identity/mfa-and-session-shape.feature
 */
import type { IdentityEmailResolution } from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryOrganizationMfaRequirementMailChannel } from "../../../../channels/memory/memory.organization-mfa-requirement-mail.channel.ts";
import { MemoryTwoStepVerificationRepository } from "../../../../repositories/memory/memory.two-step-verification.repository.ts";
import { MemoryTwoStepVerificationStore } from "../../../../repositories/memory/memory.two-step-verification.store.ts";
import { OrganizationMfaNotifierService } from "../../services/organization-mfa-notifier.service.ts";
import { runNotifyMembers } from "../two-step-requirement-notice.intent.ts";
import {
  onTwoStepRequirementChanged,
  TWO_STEP_REQUIREMENT_NOTICE_INITIAL_STATE,
  TWO_STEP_REQUIREMENT_NOTICE_PROCESS_NAME,
  type TwoStepRequirementNoticeIntents,
} from "../two-step-requirement-notice.process.ts";
import {
  RecordTwoStepRequirementChangedCommand,
  type TwoStepRequirementChangedData,
} from "../two-step-requirement.intent.ts";

const ORG = "org_acme";
const T0 = 1_760_000_000_000;
const KEEP_LEGACY: IdentityEmailResolution = { kind: "keep_legacy" };

function context(at: number): ProcessHandlerContext<TwoStepRequirementNoticeIntents> {
  return {
    at,
    now: at,
    key: ORG,
    projectId: ORG,
    intent: intentAccessorOf({
      notifyMembers: (messageKey, payload) => ({
        messageKey,
        intentType: "notifyMembers",
        payload,
      }),
    }),
  };
}

const change: TwoStepRequirementChangedData = {
  tenantId: ORG,
  organizationId: ORG,
  required: true,
  actorUserId: "user_ana",
  occurredAt: T0,
};

describe("the two-step requirement notice process", () => {
  let mail: MemoryOrganizationMfaRequirementMailChannel;
  let notices: OrganizationMfaNotifierService;

  beforeEach(() => {
    const store = MemoryTwoStepVerificationStore.create();
    const accounts = MemoryTwoStepVerificationRepository.create(store);
    store.putPerson({
      userId: "user_ana",
      name: "Ana",
      email: "ana@acme.test",
      accountEnrollmentEnabled: true,
      passkeyCount: 0,
    });
    store.putPerson({
      userId: "user_bo",
      name: "Bo",
      email: "bo@acme.test",
      accountEnrollmentEnabled: false,
      passkeyCount: 0,
    });
    store.putOrganization({ organizationId: ORG, name: "Acme", slug: "acme", mfaRequired: true });
    store.putSeat({ organizationId: ORG, userId: "user_ana" });
    store.putSeat({ organizationId: ORG, userId: "user_bo" });
    mail = MemoryOrganizationMfaRequirementMailChannel.create();
    notices = OrganizationMfaNotifierService.create({
      accounts,
      mail,
      emails: { resolveEmail: async () => KEEP_LEGACY },
    });
  });

  /** Records the change, then runs what the worker runs for the fact it appended. */
  async function handleRecordedChange() {
    const [event] = await new RecordTwoStepRequirementChangedCommand().handle({
      tenantId: createTenantId(ORG),
      aggregateId: ORG,
      type: "lw.identity.record_two_step_requirement_changed",
      data: change,
    });
    const evolution = onTwoStepRequirementChanged(
      TWO_STEP_REQUIREMENT_NOTICE_INITIAL_STATE,
      event!.data,
      context(event!.occurredAt),
    );
    const [intent] = evolution.intents ?? [];
    await runNotifyMembers({ notices })(
      { organizationId: ORG, required: true, actorUserId: "user_ana" },
      {
        processName: TWO_STEP_REQUIREMENT_NOTICE_PROCESS_NAME,
        projectId: ORG,
        processKey: ORG,
        tenantId: ORG,
        messageKey: intent!.messageKey,
        attempt: 1,
      },
    );
    return { evolution, intent: intent! };
  }

  /** @scenario "Turning the requirement on is recorded with who did it" */
  it("records the change on the organization's own aggregate with who made it", async () => {
    const [event] = await new RecordTwoStepRequirementChangedCommand().handle({
      tenantId: createTenantId(ORG),
      aggregateId: ORG,
      type: "lw.identity.record_two_step_requirement_changed",
      data: change,
    });

    expect(event).toMatchObject({
      aggregateId: ORG,
      type: "lw.identity.two_step_requirement_changed",
      data: { organizationId: ORG, required: true, actorUserId: "user_ana" },
    });
  });

  /** @scenario "Every member gets one notice of a recorded change" */
  it("sends every active member one notice naming who changed it", async () => {
    const { evolution, intent } = await handleRecordedChange();

    expect(evolution.state).toEqual(TWO_STEP_REQUIREMENT_NOTICE_INITIAL_STATE);
    expect(intent).toMatchObject({
      intentType: "notifyMembers",
      payload: { organizationId: ORG, required: true, actorUserId: "user_ana" },
    });
    expect(mail.sent).toEqual([
      {
        to: "ana@acme.test",
        organizationName: "Acme",
        actorName: "Ana",
        required: true,
        idempotencyKey: `${intent.messageKey}:user_ana`,
      },
      {
        to: "bo@acme.test",
        organizationName: "Acme",
        actorName: "Ana",
        required: true,
        idempotencyKey: `${intent.messageKey}:user_bo`,
      },
    ]);
  });

  /** @scenario "A redelivered change sends no duplicate notice" */
  it("asks for the same delivery on redelivery, and no member gets a second notice", async () => {
    const first = await handleRecordedChange();
    const redelivered = await handleRecordedChange();

    expect(redelivered.intent.messageKey).toBe(first.intent.messageKey);
    expect(mail.sent.map((sent) => sent.to)).toEqual(["ana@acme.test", "bo@acme.test"]);
  });

  it("keys a later change differently, so turning it off again tells members again", () => {
    const on = onTwoStepRequirementChanged(
      TWO_STEP_REQUIREMENT_NOTICE_INITIAL_STATE,
      change,
      context(T0),
    );
    const off = onTwoStepRequirementChanged(
      TWO_STEP_REQUIREMENT_NOTICE_INITIAL_STATE,
      { ...change, required: false, occurredAt: T0 + 60_000 },
      context(T0 + 60_000),
    );

    expect(off.intents?.[0]?.messageKey).not.toBe(on.intents?.[0]?.messageKey);
  });
});
