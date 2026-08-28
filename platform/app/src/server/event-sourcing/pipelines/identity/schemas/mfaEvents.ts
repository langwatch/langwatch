import {
  BACKUP_CODE_CONSUMED_EVENT_TYPE,
  BACKUP_CODES_REGENERATED_EVENT_TYPE,
  backupCodeConsumedPayloadSchema,
  backupCodesRegeneratedPayloadSchema,
  MFA_CONFIRMED_EVENT_TYPE,
  MFA_DISABLED_EVENT_TYPE,
  MFA_ENROLLED_EVENT_TYPE,
  MFA_ENROLLMENT_EXPIRED_EVENT_TYPE,
  MFA_VERIFICATION_FAILED_EVENT_TYPE,
  mfaConfirmedPayloadSchema,
  mfaDisabledPayloadSchema,
  mfaEnrolledPayloadSchema,
  mfaEnrollmentExpiredPayloadSchema,
  mfaVerificationFailedPayloadSchema,
} from "@langwatch/identity";
import { z } from "zod";
import { EventSchema } from "@langwatch/eventing";

/**
 * The two-step verification pipeline's wire schemas: the framework envelope
 * (id, aggregate, tenant, cursor time) over the payloads
 * `@langwatch/identity` declares. What a fact SAYS is the package's; how it
 * travels the event log is the framework's, and this file is where the two
 * meet.
 *
 * Nothing here can carry a secret or a backup code, because none of the
 * payloads it extends has a field for one.
 */

export const mfaEnrolledEventSchema = EventSchema.extend({
  type: z.literal(MFA_ENROLLED_EVENT_TYPE),
  data: mfaEnrolledPayloadSchema,
});
export type MfaEnrolledEvent = z.infer<typeof mfaEnrolledEventSchema>;

export const mfaConfirmedEventSchema = EventSchema.extend({
  type: z.literal(MFA_CONFIRMED_EVENT_TYPE),
  data: mfaConfirmedPayloadSchema,
});
export type MfaConfirmedEvent = z.infer<typeof mfaConfirmedEventSchema>;

export const mfaEnrollmentExpiredEventSchema = EventSchema.extend({
  type: z.literal(MFA_ENROLLMENT_EXPIRED_EVENT_TYPE),
  data: mfaEnrollmentExpiredPayloadSchema,
});
export type MfaEnrollmentExpiredEvent = z.infer<
  typeof mfaEnrollmentExpiredEventSchema
>;

export const mfaDisabledEventSchema = EventSchema.extend({
  type: z.literal(MFA_DISABLED_EVENT_TYPE),
  data: mfaDisabledPayloadSchema,
});
export type MfaDisabledEvent = z.infer<typeof mfaDisabledEventSchema>;

export const backupCodeConsumedEventSchema = EventSchema.extend({
  type: z.literal(BACKUP_CODE_CONSUMED_EVENT_TYPE),
  data: backupCodeConsumedPayloadSchema,
});
export type BackupCodeConsumedEvent = z.infer<
  typeof backupCodeConsumedEventSchema
>;

export const backupCodesRegeneratedEventSchema = EventSchema.extend({
  type: z.literal(BACKUP_CODES_REGENERATED_EVENT_TYPE),
  data: backupCodesRegeneratedPayloadSchema,
});
export type BackupCodesRegeneratedEvent = z.infer<
  typeof backupCodesRegeneratedEventSchema
>;

export const mfaVerificationFailedEventSchema = EventSchema.extend({
  type: z.literal(MFA_VERIFICATION_FAILED_EVENT_TYPE),
  data: mfaVerificationFailedPayloadSchema,
});
export type MfaVerificationFailedEvent = z.infer<
  typeof mfaVerificationFailedEventSchema
>;

export const mfaEventSchema = z.discriminatedUnion("type", [
  mfaEnrolledEventSchema,
  mfaConfirmedEventSchema,
  mfaEnrollmentExpiredEventSchema,
  mfaDisabledEventSchema,
  backupCodeConsumedEventSchema,
  backupCodesRegeneratedEventSchema,
  mfaVerificationFailedEventSchema,
]);
export type MfaEvent = z.infer<typeof mfaEventSchema>;
