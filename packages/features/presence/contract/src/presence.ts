import { z } from "zod";

export const PRESENCE_FEATURE_ID = "presence" as const;

export const presenceLensSchema = z.enum([
  "traces",
  "evaluations",
  "datasets",
  "experiments",
  "scenarios",
  "prompts",
  "workflows",
  "annotations",
  "settings",
  "other",
]);

export const presenceDrawerViewModeSchema = z.enum(["trace", "conversation", "scenario"]);
export const presenceVisualizationTabSchema = z.enum([
  "waterfall",
  "flame",
  "spanlist",
  "topology",
  "sequence",
]);
export const presenceDrawerTabSchema = z.enum([
  "summary",
  "llm",
  "span",
  "prompts",
  "annotations",
]);

export const presenceLocationSchema = z
  .object({
    lens: presenceLensSchema,
    route: z
      .object({
        traceId: z.string().nullable().optional(),
        conversationId: z.string().nullable().optional(),
        spanId: z.string().nullable().optional(),
      })
      .strict()
      .default({}),
    view: z
      .object({
        mode: presenceDrawerViewModeSchema.optional(),
        panel: presenceVisualizationTabSchema.optional(),
        tab: presenceDrawerTabSchema.optional(),
        section: z.string().max(64).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PresenceLocation = z.infer<typeof presenceLocationSchema>;

export const presenceUserSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    image: z.string().nullable(),
  })
  .strict();
export type PresenceUser = z.infer<typeof presenceUserSchema>;

export const presenceSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    user: presenceUserSchema,
    location: presenceLocationSchema,
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type PresenceSession = z.infer<typeof presenceSessionSchema>;

export const presenceEventSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("snapshot"), sessions: z.array(presenceSessionSchema) })
    .strict(),
  z.object({ kind: z.literal("join"), session: presenceSessionSchema }).strict(),
  z.object({ kind: z.literal("update"), session: presenceSessionSchema }).strict(),
  z.object({ kind: z.literal("leave"), sessionId: z.string().min(1) }).strict(),
]);
export type PresenceEvent = z.infer<typeof presenceEventSchema>;

export const presenceCursorAnchorSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9:_-]+$/u);

export const presenceCursorPayloadSchema = z
  .object({
    anchor: presenceCursorAnchorSchema,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
export type PresenceCursorPayload = z.infer<typeof presenceCursorPayloadSchema>;

export const presenceCursorEventSchema = presenceCursorPayloadSchema.extend({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  user: presenceUserSchema,
  emittedAt: z.number().int().nonnegative(),
});
export type PresenceCursorEvent = z.infer<typeof presenceCursorEventSchema>;

export const presenceProjectInputSchema = z
  .object({ projectId: z.string().min(1) })
  .strict();
export type PresenceProjectInput = z.infer<typeof presenceProjectInputSchema>;

export const presenceUpdateInputSchema = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    user: presenceUserSchema,
    location: presenceLocationSchema,
  })
  .strict();
export type PresenceUpdateInput = z.infer<typeof presenceUpdateInputSchema>;

export const presenceLeaveInputSchema = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict();
export type PresenceLeaveInput = z.infer<typeof presenceLeaveInputSchema>;

export const presenceCursorInputSchema = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    user: presenceUserSchema,
    payload: presenceCursorPayloadSchema,
  })
  .strict();
export type PresenceCursorInput = z.infer<typeof presenceCursorInputSchema>;
