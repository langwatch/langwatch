import { z } from "zod";

/**
 * A chat message role. Mirrors the roles the /langy/chat surface accepts plus
 * "tool" for tool-result messages the agent may record.
 */
export const langyMessageRoleSchema = z.enum([
  "user",
  "assistant",
  "system",
  "tool",
]);
export type LangyMessageRole = z.infer<typeof langyMessageRoleSchema>;

/**
 * A single UI-message part. Kept loose (a record of unknown) because the
 * content is opaque to the pipeline — the map projection stores it verbatim as
 * a JSON blob in langy_messages, and the UI flattens the text parts on read.
 * The pipeline never interprets part internals.
 */
export const langyMessagePartSchema = z.record(z.string(), z.unknown());
export type LangyMessagePart = z.infer<typeof langyMessagePartSchema>;
