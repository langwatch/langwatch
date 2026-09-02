/**
 * How a plan limit reads in a sentence, for the card Langy shows when a turn is
 * refused for one.
 *
 * `~/server/license-enforcement/constants` types this by `LimitType` from
 * `@langwatch/enterprise-licensing-contract`, and a CORE package may not depend
 * on an enterprise one — the same wall the governance family recorded about
 * `enterprise-direction`. So the labels are stated here as plain strings and
 * the lookup falls back to the raw key, which is what the card already did for
 * a limit it did not recognise.
 *
 * KEPT IN STEP BY HAND with `LIMIT_TYPE_LABELS` in the licensing package. A key
 * added there and missed here reads as its own name rather than as a sentence,
 * which is degraded and not wrong.
 */

export const LIMIT_TYPE_LABELS: Record<string, string> = {
  members: "team members",
  membersLite: "lite members",
};
