import { EventSchema } from "@langwatch/eventing";
import {
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_CREATED_EVENT_VERSION,
  projectCreatedEventDataSchema,
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
