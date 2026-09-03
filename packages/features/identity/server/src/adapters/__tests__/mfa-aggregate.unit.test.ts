import {
  emptyMfaEnrollment,
  IDENTITY_EVENT_VERSION_LATEST,
  MFA_EVENT_VERSION_LATEST,
  type MfaEnrollmentState,
  type MfaFact,
  reduceMfaEnrollment,
} from "@langwatch/identity-contract";
import type { MfaEnrollmentRepository } from "../../mfa-enrollment.repository";
import { MfaGuards } from "../../mfa-guards";
import { describe, expect, it } from "vitest";
import { type Command, createTenantId, validateEventAggregateType } from "@langwatch/eventing";
import {
  ConfirmMfaCommand,
  ConsumeBackupCodeCommand,
  DisableMfaCommand,
  EnrollMfaCommand,
  ExpireMfaEnrollmentCommand,
  RecordMfaVerificationFailureCommand,
  RegenerateBackupCodesCommand,
} from "../../intents/mfa.intent";
import { createIdentityPipeline } from "../identity-pipeline-definition.adapter";
import { USER_IDENTITY_AGGREGATE_TYPE } from "@langwatch/identity-contract";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const ENROLLMENT = "mfaenr_01";
const T0 = 1_690_000_000_000;

class EnrollmentOf implements MfaEnrollmentRepository {
  constructor(
    private readonly state: MfaEnrollmentState,
    private readonly requiring: readonly string[] = [],
  ) {}

  async findEnrollment() {
    return this.state;
  }

  async findRequiringOrganizationSlugs() {
    return this.requiring;
  }
}

function foldOf(facts: MfaFact[]): MfaEnrollmentState {
  return facts.reduce(
    (state, fact) => reduceMfaEnrollment({ state, fact }),
    emptyMfaEnrollment({ userId: USER }),
  );
}

const PENDING = foldOf([
  {
    type: "lw.identity.mfa_enrolled",
    occurredAt: T0,
    data: {
      enrollmentId: ENROLLMENT,
      userId: USER,
      method: "totp",
      actor: ACTOR,
    },
  },
]);

const ENABLED = foldOf([
  {
    type: "lw.identity.mfa_enrolled",
    occurredAt: T0,
    data: {
      enrollmentId: ENROLLMENT,
      userId: USER,
      method: "totp",
      actor: ACTOR,
    },
  },
  {
    type: "lw.identity.mfa_confirmed",
    occurredAt: T0 + 60_000,
    data: { enrollmentId: ENROLLMENT, backupCodeCount: 10, actor: ACTOR },
  },
]);

function command<T>(data: T): Command<T> {
  return {
    tenantId: createTenantId(USER),
    aggregateId: USER,
    type: "lw.identity.test",
    data,
  } as unknown as Command<T>;
}

const base = { tenantId: USER, userId: USER, occurredAtMs: T0, actor: ACTOR };

const noopStore = {
  load: async () => null,
  store: async () => undefined,
} as never;

/**
 * Two-step verification rides `user_identity` — same person, same key, so
 * the same aggregate and the same lane. Every verb's event is run through
 * the store's own validator against the identity pipeline's declared type,
 * which is what pins the two together: a fact stamped with anything else
 * would be refused at append (#7406), and the shared lane that serialises a
 * disable against an identifier detach depends on them matching.
 */
describe("two-step verification event aggregate type", () => {
  describe("when every verb emits", () => {
    it.each([
      {
        label: "enroll",
        handler: new EnrollMfaCommand(
          new MfaGuards(new EnrollmentOf(emptyMfaEnrollment({ userId: USER }))),
        ),
        data: {
          ...base,
          commandId: "mfacmd_1",
          enrollmentId: ENROLLMENT,
          method: "totp" as const,
        },
      },
      {
        label: "confirm",
        handler: new ConfirmMfaCommand(new MfaGuards(new EnrollmentOf(PENDING))),
        data: {
          ...base,
          commandId: "mfacmd_2",
          enrollmentId: ENROLLMENT,
          backupCodeCount: 10,
        },
      },
      {
        label: "expire",
        handler: new ExpireMfaEnrollmentCommand(new MfaGuards(new EnrollmentOf(PENDING))),
        data: {
          tenantId: USER,
          userId: USER,
          occurredAtMs: T0,
          commandId: "mfacmd_3",
          enrollmentId: ENROLLMENT,
        },
      },
      {
        label: "disable",
        handler: new DisableMfaCommand(new MfaGuards(new EnrollmentOf(ENABLED))),
        data: {
          ...base,
          commandId: "mfacmd_4",
          via: "password+totp" as const,
          requiringOrganizationSlugs: [],
        },
      },
      {
        label: "consume backup code",
        handler: new ConsumeBackupCodeCommand(new MfaGuards(new EnrollmentOf(ENABLED))),
        data: {
          tenantId: USER,
          userId: USER,
          occurredAtMs: T0,
          commandId: "mfacmd_5",
          codeIndex: 0,
        },
      },
      {
        label: "regenerate backup codes",
        handler: new RegenerateBackupCodesCommand(new MfaGuards(new EnrollmentOf(ENABLED))),
        data: { ...base, commandId: "mfacmd_6", backupCodeCount: 10 },
      },
      {
        label: "record failure",
        handler: new RecordMfaVerificationFailureCommand(new MfaGuards(new EnrollmentOf(ENABLED))),
        data: {
          tenantId: USER,
          userId: USER,
          occurredAtMs: T0,
          commandId: "mfacmd_7",
          failedCount: 2,
        },
      },
    ])("stamps $label with the pipeline's declared aggregate type", async ({ handler, data }) => {
      const declared = createIdentityPipeline({
        identityProjectionStore: noopStore,
        identityGuards: null as never,
        mfaProjectionStore: noopStore,
        mfaGuards: new MfaGuards(new EnrollmentOf(ENABLED)),
      }).metadata.aggregateType;

      const events = await handler.handle(command(data) as never);
      expect(events.length).toBeGreaterThan(0);
      for (const [index, event] of events.entries()) {
        expect(() => validateEventAggregateType(event as never, declared, index)).not.toThrow();
      }
    });
  });

  describe("when a fact is stamped", () => {
    /** @scenario "Starting a setup records the fact and never the secret" */
    it("appends under the person as both aggregate and tenant", async () => {
      const handler = new EnrollMfaCommand(
        new MfaGuards(new EnrollmentOf(emptyMfaEnrollment({ userId: USER }))),
      );

      const [event] = await handler.handle(
        command({
          ...base,
          commandId: "mfacmd_8",
          enrollmentId: ENROLLMENT,
          method: "totp" as const,
        }) as never,
      );

      expect(event).toMatchObject({
        type: "lw.identity.mfa_enrolled",
        aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
        aggregateId: USER,
        occurredAt: T0,
      });
      expect(String((event as { tenantId: unknown }).tenantId)).toContain(USER);
      // The whole payload, so there is nowhere a secret could be hiding.
      expect(Object.keys((event as { data: object }).data).sort()).toEqual([
        "actor",
        "enrollmentId",
        "method",
        "userId",
      ]);
    });

    /** @scenario "Starting a setup records the fact and never the secret" */
    it("stamps its own schema version, not the identifier vocabulary's", async () => {
      // Two families on one aggregate, evolving independently. Fold read-back
      // is version-gated, so sharing a stamp would tie an MFA payload change
      // to an identifier-vocabulary bump and leave every identifier event
      // claiming a version nothing in it had changed.
      const [mfaEvent] = await new EnrollMfaCommand(
        new MfaGuards(new EnrollmentOf(emptyMfaEnrollment({ userId: USER }))),
      ).handle(
        command({
          ...base,
          commandId: "mfacmd_v",
          enrollmentId: ENROLLMENT,
          method: "totp" as const,
        }) as never,
      );

      expect((mfaEvent as { version: string }).version).toBe(MFA_EVENT_VERSION_LATEST);
      expect(MFA_EVENT_VERSION_LATEST).not.toBe(IDENTITY_EVENT_VERSION_LATEST);
    });

    /** @scenario "One person has one setup, however many organizations they belong to" */
    it("takes the aggregate id from the person, never from an organization", () => {
      expect(EnrollMfaCommand.getAggregateId({ userId: USER })).toBe(USER);
      expect(ConfirmMfaCommand.getAggregateId({ userId: USER })).toBe(USER);
      expect(DisableMfaCommand.getAggregateId({ userId: USER })).toBe(USER);
    });
  });
});
