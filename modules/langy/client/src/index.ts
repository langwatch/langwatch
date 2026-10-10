/** What Langy lends by token: the panel the guided onboarding docks and kicks off. */

import type { LangyKickoffBrief } from "@langwatch/langy-contract";
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
