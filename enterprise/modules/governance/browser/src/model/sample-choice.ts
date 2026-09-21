/**
 * What a peer browser may do to governance's sample-data choice, and nothing
 * else: the guided tour shows the sample panels while it runs and puts them
 * back when it ends. The choice itself stays governance's own state.
 */

/** Shown, hidden, or never answered — the third is the screens' own default. */
export type SampleChoice = boolean | null;

export interface GovernanceSampleCapability {
  setSampleChoice(choice: SampleChoice): void;
}
