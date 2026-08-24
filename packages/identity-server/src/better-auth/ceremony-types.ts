/** The effect seams the ceremonies share, composed once in the app. */
export interface IdentityCeremonyClock {
  now: () => number;
  newCommandId: () => string;
}
