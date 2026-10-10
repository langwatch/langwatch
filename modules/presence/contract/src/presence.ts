import type { Named } from "@langwatch/module";
import { z } from "zod";

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
export const presenceDrawerTabSchema = z.enum(["summary", "llm", "span", "prompts", "annotations"]);

const presenceLocationSchemaDefinition = z
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
export interface PresenceLocationSchema extends Named<typeof presenceLocationSchemaDefinition> {}
export const presenceLocationSchema: PresenceLocationSchema = presenceLocationSchemaDefinition;
export type PresenceLocation = z.infer<typeof presenceLocationSchema>;

const presenceUserSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    image: z.string().nullable(),
  })
  .strict();
export interface PresenceUserSchema extends Named<typeof presenceUserSchemaDefinition> {}
export const presenceUserSchema: PresenceUserSchema = presenceUserSchemaDefinition;
export type PresenceUser = z.infer<typeof presenceUserSchema>;

const presenceSessionSchemaDefinition = z
  .object({
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    user: presenceUserSchema,
    location: presenceLocationSchema,
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export interface PresenceSessionSchema extends Named<typeof presenceSessionSchemaDefinition> {}
export const presenceSessionSchema: PresenceSessionSchema = presenceSessionSchemaDefinition;
export type PresenceSession = z.infer<typeof presenceSessionSchema>;

const presenceEventSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), sessions: z.array(presenceSessionSchema) }).strict(),
  z.object({ kind: z.literal("join"), session: presenceSessionSchema }).strict(),
  z.object({ kind: z.literal("update"), session: presenceSessionSchema }).strict(),
  z.object({ kind: z.literal("leave"), sessionId: z.string().min(1) }).strict(),
]);
export interface PresenceEventSchema extends Named<typeof presenceEventSchemaDefinition> {}
export const presenceEventSchema: PresenceEventSchema = presenceEventSchemaDefinition;
export type PresenceEvent = z.infer<typeof presenceEventSchema>;

export const presenceCursorAnchorSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9:_-]+$/u);

const presenceCursorPayloadSchemaDefinition = z
  .object({
    anchor: presenceCursorAnchorSchema,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
export interface PresenceCursorPayloadSchema extends Named<
  typeof presenceCursorPayloadSchemaDefinition
> {}
export const presenceCursorPayloadSchema: PresenceCursorPayloadSchema =
  presenceCursorPayloadSchemaDefinition;
export type PresenceCursorPayload = z.infer<typeof presenceCursorPayloadSchema>;

const presenceCursorEventSchemaDefinition = presenceCursorPayloadSchema.safeExtend({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  user: presenceUserSchema,
  emittedAt: z.number().int().nonnegative(),
});
export interface PresenceCursorEventSchema extends Named<
  typeof presenceCursorEventSchemaDefinition
> {}
export const presenceCursorEventSchema: PresenceCursorEventSchema =
  presenceCursorEventSchemaDefinition;
export type PresenceCursorEvent = z.infer<typeof presenceCursorEventSchema>;

const presenceProjectInputSchemaDefinition = z.object({ projectId: z.string().min(1) }).strict();
export interface PresenceProjectInputSchema extends Named<
  typeof presenceProjectInputSchemaDefinition
> {}
export const presenceProjectInputSchema: PresenceProjectInputSchema =
  presenceProjectInputSchemaDefinition;
export type PresenceProjectInput = z.infer<typeof presenceProjectInputSchema>;

const presenceUpdateInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    user: presenceUserSchema,
    location: presenceLocationSchema,
  })
  .strict();
export interface PresenceUpdateInputSchema extends Named<
  typeof presenceUpdateInputSchemaDefinition
> {}
export const presenceUpdateInputSchema: PresenceUpdateInputSchema =
  presenceUpdateInputSchemaDefinition;
export type PresenceUpdateInput = z.infer<typeof presenceUpdateInputSchema>;

/**
 * What a browser publishes on a heartbeat. The presenting person is absent by
 * construction: it is read from the authenticated session, so a payload cannot
 * claim somebody else's name or avatar.
 */
const presenceUpdateRequestSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    location: presenceLocationSchema,
  })
  .strict();
export interface PresenceUpdateRequestSchema extends Named<
  typeof presenceUpdateRequestSchemaDefinition
> {}
export const presenceUpdateRequestSchema: PresenceUpdateRequestSchema =
  presenceUpdateRequestSchemaDefinition;
export type PresenceUpdateRequest = z.infer<typeof presenceUpdateRequestSchema>;

const presenceLeaveRequestSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict();
export interface PresenceLeaveRequestSchema extends Named<
  typeof presenceLeaveRequestSchemaDefinition
> {}
export const presenceLeaveRequestSchema: PresenceLeaveRequestSchema =
  presenceLeaveRequestSchemaDefinition;
export type PresenceLeaveRequest = z.infer<typeof presenceLeaveRequestSchema>;

const presenceLeaveInputSchemaDefinition = z
  .object({
    ...presenceLeaveRequestSchema.shape,
    /**
     * Who is asking. Read from the authenticated session by the transport, never from the
     * payload: a session is removed only by the person publishing it.
     */
    userId: z.string().min(1),
  })
  .strict();
export interface PresenceLeaveInputSchema extends Named<
  typeof presenceLeaveInputSchemaDefinition
> {}
export const presenceLeaveInputSchema: PresenceLeaveInputSchema =
  presenceLeaveInputSchemaDefinition;
export type PresenceLeaveInput = z.infer<typeof presenceLeaveInputSchema>;

const presenceCursorInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    user: presenceUserSchema,
    payload: presenceCursorPayloadSchema,
  })
  .strict();
export interface PresenceCursorInputSchema extends Named<
  typeof presenceCursorInputSchemaDefinition
> {}
export const presenceCursorInputSchema: PresenceCursorInputSchema =
  presenceCursorInputSchemaDefinition;
export type PresenceCursorInput = z.infer<typeof presenceCursorInputSchema>;

/** One cursor tick as a browser publishes it; the person comes from the session. */
const presenceCursorRequestSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    payload: presenceCursorPayloadSchema,
  })
  .strict();
export interface PresenceCursorRequestSchema extends Named<
  typeof presenceCursorRequestSchemaDefinition
> {}
export const presenceCursorRequestSchema: PresenceCursorRequestSchema =
  presenceCursorRequestSchemaDefinition;
export type PresenceCursorRequest = z.infer<typeof presenceCursorRequestSchema>;

/** The cursors of one anchor, minus the subscriber's own. */
const presenceCursorSubscriptionSchemaDefinition = z
  .object({
    ...presenceProjectInputSchema.shape,
    anchor: presenceCursorAnchorSchema,
    sessionId: z.string().min(1),
  })
  .strict();
export interface PresenceCursorSubscriptionSchema extends Named<
  typeof presenceCursorSubscriptionSchemaDefinition
> {}
export const presenceCursorSubscriptionSchema: PresenceCursorSubscriptionSchema =
  presenceCursorSubscriptionSchemaDefinition;
export type PresenceCursorSubscription = z.infer<typeof presenceCursorSubscriptionSchema>;

/** What the presence writes answer with: the tick was accepted. */
const presenceAcknowledgedSchemaDefinition = z.object({ ok: z.literal(true) }).strict();
export interface PresenceAcknowledgedSchema extends Named<
  typeof presenceAcknowledgedSchemaDefinition
> {}
export const presenceAcknowledgedSchema: PresenceAcknowledgedSchema =
  presenceAcknowledgedSchemaDefinition;
export type PresenceAcknowledged = z.infer<typeof presenceAcknowledgedSchema>;

export type PresenceDisabledScope = "organization" | "project" | null;

export interface PresenceAvailability {
  /** True when presence is allowed for the current project. */
  enabled: boolean;
  /** Which level disabled it (organization wins over project), or null. */
  disabledAt: PresenceDisabledScope;
}

export function resolvePresenceAvailability({
  organizationPresenceEnabled,
  projectPresenceEnabled,
}: {
  organizationPresenceEnabled?: boolean | undefined;
  projectPresenceEnabled?: boolean | undefined;
}): PresenceAvailability {
  if (organizationPresenceEnabled === false) return { enabled: false, disabledAt: "organization" };
  if (projectPresenceEnabled === false) return { enabled: false, disabledAt: "project" };
  return { enabled: true, disabledAt: null };
}
