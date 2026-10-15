import { EventSchema } from "@langwatch/eventing";
import {
  USER_CREATED_EVENT_TYPE,
  USER_DEACTIVATED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  USER_REACTIVATED_EVENT_TYPE,
  USER_REGISTERED_EVENT_TYPE,
  userCreatedEventDataSchema,
  userErasedEventDataSchema,
  userLifecycleEventDataSchema,
  userRegisteredEventDataSchema,
} from "@langwatch/user-contract";
import { z } from "zod";

export const RECORD_USER_DEACTIVATED_COMMAND_TYPE = "lw.user.record_deactivated" as const;
export const RECORD_USER_REACTIVATED_COMMAND_TYPE = "lw.user.record_reactivated" as const;
export const RECORD_USER_REGISTERED_COMMAND_TYPE = "lw.user.record_registered" as const;
export const RECORD_USER_CREATED_COMMAND_TYPE = "lw.user.record_created" as const;
export const RECORD_USER_ERASED_COMMAND_TYPE = "lw.user.record_erased" as const;

export const recordUserLifecycleCommandDataSchema = userLifecycleEventDataSchema;
export type RecordUserLifecycleCommandData = z.infer<typeof recordUserLifecycleCommandDataSchema>;
export const recordUserRegisteredCommandDataSchema = userRegisteredEventDataSchema;
export type RecordUserRegisteredCommandData = z.infer<typeof recordUserRegisteredCommandDataSchema>;
export const recordUserCreatedCommandDataSchema = userCreatedEventDataSchema;
export type RecordUserCreatedCommandData = z.infer<typeof recordUserCreatedCommandDataSchema>;
export const recordUserErasedCommandDataSchema = userErasedEventDataSchema;
export type RecordUserErasedCommandData = z.infer<typeof recordUserErasedCommandDataSchema>;

export const userDeactivatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USER_DEACTIVATED_EVENT_TYPE),
  version: z.literal(USER_LIFECYCLE_EVENT_VERSION),
  data: userLifecycleEventDataSchema,
});
export type UserDeactivatedEvent = z.infer<typeof userDeactivatedEventSchema>;

export const userReactivatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USER_REACTIVATED_EVENT_TYPE),
  version: z.literal(USER_LIFECYCLE_EVENT_VERSION),
  data: userLifecycleEventDataSchema,
});
export type UserReactivatedEvent = z.infer<typeof userReactivatedEventSchema>;

export const userRegisteredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USER_REGISTERED_EVENT_TYPE),
  version: z.literal(USER_LIFECYCLE_EVENT_VERSION),
  data: userRegisteredEventDataSchema,
});
export type UserRegisteredEvent = z.infer<typeof userRegisteredEventSchema>;

export const userCreatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USER_CREATED_EVENT_TYPE),
  version: z.literal(USER_LIFECYCLE_EVENT_VERSION),
  data: userCreatedEventDataSchema,
});
export type UserCreatedEvent = z.infer<typeof userCreatedEventSchema>;

export const userErasedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USER_ERASED_EVENT_TYPE),
  version: z.literal(USER_LIFECYCLE_EVENT_VERSION),
  data: userErasedEventDataSchema,
});
export type UserErasedEvent = z.infer<typeof userErasedEventSchema>;
