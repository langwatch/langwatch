import { z } from "zod";

export type LangyJsonValue =
  | string
  | number
  | boolean
  | null
  | LangyJsonValue[]
  | { [key: string]: LangyJsonValue };

export type LangyJsonObject = { [key: string]: LangyJsonValue };

/** JSON-safe by construction at the event boundary. */
export const langyJsonValueSchema: z.ZodType<LangyJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(langyJsonValueSchema),
    z.record(z.string(), langyJsonValueSchema),
  ]),
);

/**
 * A chat message role. Mirrors the roles the Langy turn surface accepts plus
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
 * content is opaque to the pipeline — the message projection stores it verbatim
 * as JSON, and the UI flattens the text parts on read.
 * The pipeline never interprets part internals.
 */
export const langyMessagePartSchema = z.record(
  z.string(),
  langyJsonValueSchema,
);
export type LangyMessagePart = z.infer<typeof langyMessagePartSchema>;
