/** What another module hands Langy when it asks about that module's screen (§10.1). */

import type { LangyAttachedContextType } from "./langy-slice.ts";

/** One reference the asking module hands over with its question; `ref` is the chip's id too. */
export type LangyAskContext = { kind: LangyAttachedContextType; ref: string; label: string };

/** What a draft is about: a thing on screen (a dashboard), and an item within it (a widget). */
export type LangyDraftAbout = { ref: string; itemRef?: string };

/** A question to ask outright, or a sentence for the reader to finish, with its context. */
export type LangyAskRequest = {
  question?: string;
  draft?: string;
  /** Scopes a draft: left unsent, it is dropped once what it is about leaves the screen. */
  about?: LangyDraftAbout;
  context?: readonly LangyAskContext[];
};

/**
 * The docked panel's width on the right edge, so an asking module's own drawer can stop
 * short of it and sit beside Langy rather than under or over it.
 */
export const LANGY_DOCK_WIDTH_PX = 392;

/*
 * The one product event for a question a member puts to Langy, wherever they ask it:
 * `langy.asked.question` once the host composes it. It carries where it was asked, never the text.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

/** Where a member asked: the Langy composer, a board's ask bar, or "Add a widget". */
export const LANGY_ASK_SURFACES = ["composer", "ask_bar", "add_widget"] as const;
/** One place a member can ask Langy from. */
export type LangyAskSurface = (typeof LANGY_ASK_SURFACES)[number];

/** The event, shaped as the browser host's analytics event; never the question's text. */
export type LangyQuestionAskedEvent = Readonly<{
  boundary: "langy";
  action: "asked";
  name: "question";
  attributes: Readonly<{ surface: LangyAskSurface }>;
}>;

/** A question a member sent to Langy. */
export function langyQuestionAsked({
  surface,
}: {
  surface: LangyAskSurface;
}): LangyQuestionAskedEvent {
  return { boundary: "langy", action: "asked", name: "question", attributes: { surface } };
}
