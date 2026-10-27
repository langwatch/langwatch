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
