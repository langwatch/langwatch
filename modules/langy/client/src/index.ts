/**
 * What Langy lends by token: the panel the guided onboarding docks and kicks off, and the
 * ask another module puts to it about its own screen.
 */

import type {
  LangyAskRequest,
  LangyDraftAbout,
  LangyKickoffBrief,
} from "@langwatch/langy-contract";
import { uiTokens } from "@langwatch/module";

/** Dock the panel and hand it the guided kickoff. */
export type LangyGuidedOnboarding = {
  dock(): void;
  queueKickoff(kickoff: LangyKickoffBrief): void;
  /** Calls back once, with the scope the panel announced; returns the release. */
  onScopeAnnounced(announced: (scope: { organizationId: string | null }) => void): () => void;
};

export const GuidedOnboardingToken =
  uiTokens("langy").hooks<LangyGuidedOnboarding>("guidedOnboarding");

/** All another module may do to the panel by asking; Langy's store stays its own. */
export type LangyAsk = {
  ask(request: LangyAskRequest): void;
  /** What the page shows now, null when nothing a draft can be about is on screen. */
  onScreen(about: LangyDraftAbout | null): void;
};

export const LangyAskToken = uiTokens("langy").operations<LangyAsk>("langyAsk");
