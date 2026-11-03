import {
  CODING_AGENT_SESSION_STORED_EVENT_TYPE,
  codingAgentSessionStoredEventDataSchema,
} from "@langwatch/coding-agent-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

/** A project's coding-agent milestones, recorded by the session-facts service. */
export const CODING_AGENT_PROJECT_MILESTONES_PIPELINE_NAME =
  "coding_agent_project_milestones" as const;
export const CODING_AGENT_PROJECT_MILESTONE_AGGREGATE_TYPE =
  "coding_agent_project_milestone" as const;
export const CODING_AGENT_PROJECT_MILESTONES_EVENT_VERSION = "2026-10-21" as const;

export const RECORD_CODING_AGENT_SESSION_STORED_COMMAND_TYPE =
  "lw.coding_agent.record_session_stored" as const;

export const recordCodingAgentSessionStoredCommandDataSchema =
  codingAgentSessionStoredEventDataSchema;
export type RecordCodingAgentSessionStoredCommandData = z.infer<
  typeof recordCodingAgentSessionStoredCommandDataSchema
>;

export const codingAgentSessionStoredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CODING_AGENT_SESSION_STORED_EVENT_TYPE),
  version: z.literal(CODING_AGENT_PROJECT_MILESTONES_EVENT_VERSION),
  data: recordCodingAgentSessionStoredCommandDataSchema,
});
export type CodingAgentSessionStoredEvent = z.infer<typeof codingAgentSessionStoredEventSchema>;
