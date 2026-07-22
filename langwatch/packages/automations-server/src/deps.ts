/**
 * The injected-dependency contract (ADR-063 §1): everything this package
 * cannot own arrives through these ports, constructed at the app's
 * composition root. Repository interfaces join from @langwatch/automations
 * as the service moves land; ports that exist only here are defined here.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
