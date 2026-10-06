/**
 * The actions a page lends to the guided tour: registered on mount, taken
 * back on unmount, so a step whose page is gone does nothing. One that
 * fires a request hands back its promise, so the tour can wait for it.
 */
import type { GuidedTourActions } from "@langwatch/onboarding-contract";

export type TourActions = GuidedTourActions;
