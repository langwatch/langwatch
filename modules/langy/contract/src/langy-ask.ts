/** What Langy lends another module for asking it about that module's screen (§10.1). */

import { uiTokens } from "@langwatch/module";

import type { LangyAttachedContextType } from "./langy-slice.ts";

/** One reference the asking module hands over with its question; `ref` is the chip's id too. */
export type LangyAskContext = { kind: LangyAttachedContextType; ref: string; label: string };

/** A question to ask outright, or a sentence for the reader to finish, with its context. */
export type LangyAskRequest = {
  question?: string;
  draft?: string;
  context?: readonly LangyAskContext[];
};

/** All another module may do to the panel by asking; Langy's store stays its own. */
export type LangyAsk = {
  ask(request: LangyAskRequest): void;
};

export const LangyAskToken = uiTokens("langy").operations<LangyAsk>("langyAsk");
