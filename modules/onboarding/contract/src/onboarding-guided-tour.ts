/**
 * What onboarding lends the pages the guided tour visits: register the actions the tour may
 * drive, and record the key the tour minted. Hooks, read during render (ARCHITECTURE.md §10).
 */

import { uiTokens } from "@langwatch/module";

/** What a page can lend the guided tour to drive while it is mounted. */
export type GuidedTourActions = {
  expandGroup: (id: string) => void;
  collapseGroup: (id: string) => void;
  /** Puts every group the tour folded or opened back how the user had it. */
  restoreGroups: () => void;
  openVirtualKeyCreate: () => void;
  typeVirtualKeyName: (name: string) => void;
  /** Hands back the create request, so the tour knows when it answered. */
  submitVirtualKeyCreate: () => Promise<void>;
  revealVirtualKeySecret: () => void;
  /** Turns the governance sample panels on, for whichever page is in view. */
  showSampleData: () => void;
  /** Turns them off again, so nothing invented outlives the tour. */
  hideSampleData: () => void;
  /** Opens the inventory's Add source menu, the governance tour's last stop. */
  openAddSourceMenu: () => void;
};

/** The key the tour minted, as the guided state keeps it for Langy's secret snippet card. */
export type GuidedTourKeyReveal = {
  organizationId: string;
  name: string;
  preview: string;
  revealId: string;
};

export type GuidedTourHooks = {
  /** Lends `actions` to the tour while the caller is mounted; pass a memoised object. */
  useRegisterActions: (actions: Partial<GuidedTourActions>) => void;
  /** Settles once the guided state has recorded the key and been refreshed; rejects if not. */
  useRecordVirtualKeyReveal: () => (input: GuidedTourKeyReveal) => Promise<void>;
};

export const GuidedTourToken = uiTokens("onboarding").hooks<GuidedTourHooks>("guidedTourActions");
