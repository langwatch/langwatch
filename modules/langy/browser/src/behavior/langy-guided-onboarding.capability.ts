import { type LangyScope, useLangyStore } from "@langwatch/langy-browser-kit";
import type { LangyKickoffBrief } from "@langwatch/langy-contract";

/**
 * What another module may do to the Langy panel, and nothing more. A consumer
 * takes this through its own `*HostApi`, which the shell wires from here;
 * Langy's store stays private to Langy.
 */
export interface LangyGuidedOnboardingCapability {
  /** Open the panel in the sidebar, which every handover does first. */
  dock: () => void;
  /** Open Langy and queue the brief it sends on the next idle render. */
  queueKickoff: (brief: LangyKickoffBrief) => void;
  /**
   * Call back once the panel has announced the scope it belongs to. Returns
   * the release. The announcement resets every scoped field, a queued kickoff
   * included, so a brief handed over before it would be lost.
   */
  onScopeAnnounced: (announced: (scope: LangyScope) => void) => () => void;
}

export const langyGuidedOnboarding: LangyGuidedOnboardingCapability = {
  dock: () => {
    const langy = useLangyStore.getState();
    langy.openPanel();
    langy.setPanelMode("sidebar");
  },

  queueKickoff: (brief) => useLangyStore.getState().queueGuidedKickoff(brief),

  onScopeAnnounced: (announced) => {
    const state = useLangyStore.getState();
    if (state.scopeAnnounced && state.activeConversationScope) {
      announced(state.activeConversationScope);
      return () => undefined;
    }
    const release = useLangyStore.subscribe((langy) => {
      if (!langy.scopeAnnounced || !langy.activeConversationScope) return;
      release();
      announced(langy.activeConversationScope);
    });
    return release;
  },
};
