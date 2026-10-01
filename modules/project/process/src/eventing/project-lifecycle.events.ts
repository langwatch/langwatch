import { EventSchema } from "@langwatch/eventing";
import {
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_CREATED_EVENT_VERSION,
  PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE,
  PROJECT_LEGACY_KEY_REVOKED_EVENT_VERSION,
  projectCreatedEventDataSchema,
  projectLegacyKeyRevokedEventDataSchema,
} from "@langwatch/project-contract";
import { z } from "zod";

export const RECORD_PROJECT_CREATED_COMMAND_TYPE = "lw.project.record_created" as const;

export const recordProjectCreatedCommandDataSchema = projectCreatedEventDataSchema;
export type RecordProjectCreatedCommandData = z.infer<typeof recordProjectCreatedCommandDataSchema>;

export const projectCreatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_CREATED_EVENT_TYPE),
  version: z.literal(PROJECT_CREATED_EVENT_VERSION),
  data: projectCreatedEventDataSchema,
});
export type ProjectCreatedEvent = z.infer<typeof projectCreatedEventSchema>;

export const RECORD_PROJECT_LEGACY_KEY_REVOKED_COMMAND_TYPE =
  "lw.project.record_legacy_key_revoked" as const;

export const recordProjectLegacyKeyRevokedCommandDataSchema =
  projectLegacyKeyRevokedEventDataSchema;
export type RecordProjectLegacyKeyRevokedCommandData = z.infer<
  typeof recordProjectLegacyKeyRevokedCommandDataSchema
>;

export const projectLegacyKeyRevokedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE),
  version: z.literal(PROJECT_LEGACY_KEY_REVOKED_EVENT_VERSION),
  data: projectLegacyKeyRevokedEventDataSchema,
});
export type ProjectLegacyKeyRevokedEvent = z.infer<typeof projectLegacyKeyRevokedEventSchema>;
