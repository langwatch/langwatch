// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The create-coupon drawer's draft and how it becomes a request. */

import {
  type CouponDuration,
  type CouponInputProblem,
  type CreateCouponRequest,
  findCouponRequestProblems,
} from "@langwatch/enterprise-billing-contract";
import type { Instant } from "@langwatch/time";

export type CouponDraft = {
  percentOff: string;
  duration: CouponDuration;
  durationInMonths: string;
  name: string;
  code: string;
  includeEvents: boolean;
  maxRedemptions: string;
  /** A calendar date (YYYY-MM-DD); the code lasts to the end of that day, UTC. */
  expiresOn: string;
};

export type CouponField = CouponInputProblem["field"];
export type CouponProblems = Partial<Record<CouponField, string>>;

export function emptyCouponDraft(): CouponDraft {
  return {
    percentOff: "",
    duration: "repeating",
    durationInMonths: "2",
    name: "",
    code: "",
    includeEvents: false,
    maxRedemptions: "",
    expiresOn: "",
  };
}

const numberOrUndefined = (value: string): number | undefined =>
  value.trim() === "" ? undefined : Number(value);

/** The request the drawer sends; validation is the shared rule's, not this function's. */
export function couponRequestFrom(draft: CouponDraft): CreateCouponRequest {
  const name = draft.name.trim();
  return {
    percentOff: Number(draft.percentOff),
    duration: draft.duration,
    ...(draft.duration === "repeating"
      ? { durationInMonths: numberOrUndefined(draft.durationInMonths) }
      : {}),
    ...(name ? { name } : {}),
    code: draft.code.trim(),
    includeEvents: draft.includeEvents,
    ...(draft.maxRedemptions.trim() === "" ? {} : { maxRedemptions: Number(draft.maxRedemptions) }),
    ...(draft.expiresOn ? { expiresAt: `${draft.expiresOn}T23:59:59Z` } : {}),
  };
}

/** The first problem with each field, as the shared rule names it. */
export function couponProblemsOf({
  draft,
  now,
}: {
  draft: CouponDraft;
  now: Instant;
}): CouponProblems {
  const problems: CouponProblems = {};
  for (const { field, message } of findCouponRequestProblems({
    request: couponRequestFrom(draft),
    now,
  })) {
    problems[field] ??= message;
  }
  return problems;
}
