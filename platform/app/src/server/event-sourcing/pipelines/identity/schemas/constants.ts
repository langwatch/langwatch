export const IDENTITY_PIPELINE_NAME = "identity" as const;
export const USER_IDENTITY_AGGREGATE_TYPE = "user_identity" as const;

/**
 * The identity pipeline (ADR-101, D01). One aggregate per user
 * (`aggregateId = userId`, and `tenantId = userId` — the user is the tenant
 * of their own identity history, which makes erasure and support lookup a
 * single tenant scan, ADR-029 §4). The sign-in hot path never reads these —
 * it reads the Postgres `Identifier` projection the fold maintains.
 */

export const ATTACH_IDENTIFIER_COMMAND_TYPE =
  "lw.identity.attach_identifier" as const;
export const VERIFY_IDENTIFIER_COMMAND_TYPE =
  "lw.identity.verify_identifier" as const;
export const MARK_PRIMARY_COMMAND_TYPE = "lw.identity.mark_primary" as const;
export const DETACH_IDENTIFIER_COMMAND_TYPE =
  "lw.identity.detach_identifier" as const;
export const ERASE_USER_COMMAND_TYPE = "lw.identity.erase_user" as const;

export const IDENTITY_COMMAND_TYPES = [
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
  MARK_PRIMARY_COMMAND_TYPE,
  DETACH_IDENTIFIER_COMMAND_TYPE,
  ERASE_USER_COMMAND_TYPE,
] as const;

export const IDENTIFIER_ATTACHED_EVENT_TYPE =
  "lw.identity.identifier_attached" as const;
export const IDENTIFIER_VERIFIED_EVENT_TYPE =
  "lw.identity.identifier_verified" as const;
export const IDENTIFIER_DEAD_ENDED_EVENT_TYPE =
  "lw.identity.identifier_dead_ended" as const;
export const PRIMARY_CHANGED_EVENT_TYPE =
  "lw.identity.primary_changed" as const;
export const IDENTIFIER_DETACHED_EVENT_TYPE =
  "lw.identity.identifier_detached" as const;
export const USER_ERASED_EVENT_TYPE = "lw.identity.user_erased" as const;

export const IDENTITY_EVENT_TYPES = [
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  PRIMARY_CHANGED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
] as const;

export const IDENTITY_EVENT_VERSION_LATEST = "2026-08-20" as const;
