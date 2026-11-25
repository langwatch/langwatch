/** What governance lends other modules' screens by token (ARCHITECTURE.md §10.1). */

import { uiTokens } from "@langwatch/module";

/** Governance's sample-data choice, written by onboarding's guided tour. */
export type GovernanceSampleChoice = { setSampleChoice(choice: boolean): void };

export const SampleChoiceToken =
  uiTokens("governance").hooks<GovernanceSampleChoice>("sampleChoice");
