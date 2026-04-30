import { z } from "zod";

const presenceLensSchema = z.enum([
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
type PresenceLens = z.infer<typeof presenceLensSchema>;

const presenceDrawerViewModeSchema = z.enum([
  "trace",
  "conversation",
  "scenario",
]);
const presenceVizTabSchema = z.enum([
  "waterfall",
  "flame",
  "spanlist",
  "topology",
  "sequence",
]);
const presenceDrawerTabSchema = z.enum([
  "summary",
  "llm",
  "span",
  "prompts",
  "annotations",
]);

export const presenceLocationSchema = z.object({
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
      panel: presenceVizTabSchema.optional(),
      tab: presenceDrawerTabSchema.optional(),
      /**
       * Optional id of the section the user is reading inside the active
       * tab — driven by an IntersectionObserver on the consumer side. The
       * server is intentionally permissive here: any string is accepted so
       * we can rename or add sections on the client without a schema bump.
       */
      section: z.string().max(64).optional(),
    })
    .strict()
    .optional(),
});
export type PresenceLocation = z.infer<typeof presenceLocationSchema>;

/**
 * Deliberately excludes `email`. Presence is fanned out to every project
 * member with `traces:view`, and the UI only needs identity for the
 * avatar + tooltip — broadcasting addresses would leak them between
 * teammates for no rendering benefit.
 */
export interface PresenceUser {
  id: string;
  name: string | null;
  image: string | null;
}

export interface PresenceSession {
  sessionId: string;
  projectId: string;
  user: PresenceUser;
  location: PresenceLocation;
  updatedAt: number;
}

export type PresenceEvent =
  | { kind: "snapshot"; sessions: PresenceSession[] }
  | { kind: "join"; session: PresenceSession }
  | { kind: "update"; session: PresenceSession }
  | { kind: "leave"; sessionId: string };

/**
 * Anchor identifies a co-viewable surface where peer cursors are meaningful.
 * The convention is colon-delimited segments, e.g. `trace:abc:panel:flame`.
 * Only peers whose anchor matches receive each other's cursor events.
 */
export const presenceCursorAnchorSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9:_\-]+$/);

export const presenceCursorPayloadSchema = z.object({
  anchor: presenceCursorAnchorSchema,
  /** X coordinate in fractional units (0..1) of the anchor's bounding box. */
  x: z.number().min(0).max(1),
  /** Y coordinate in fractional units (0..1) of the anchor's bounding box. */
  y: z.number().min(0).max(1),
});
export type PresenceCursorPayload = z.infer<typeof presenceCursorPayloadSchema>;

export interface PresenceCursorEvent extends PresenceCursorPayload {
  sessionId: string;
  user: PresenceUser;
  /** Server timestamp; subscribers use this to drop stale ticks. */
  emittedAt: number;
}
