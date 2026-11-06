// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a create-coupon request must hold before anything reaches Stripe; see coupons.feature.
 * Shared by the service that refuses it and the drawer that says so as the operator types.
 */

import { Temporal, type Instant } from "@langwatch/time";

import type { CouponInputProblem, CreateCouponRequest } from "./billing-coupons.schemas.ts";

/** Stripe's own ceiling on a repeating coupon is generous; three years keeps typos out. */
const MAX_DURATION_MONTHS = 36;
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Every field the request gets wrong, judged at `now`; empty when it may be created. */
export function findCouponRequestProblems({
  request,
  now,
}: {
  request: CreateCouponRequest;
  now: Instant;
}): CouponInputProblem[] {
  const problems: CouponInputProblem[] = [];
  const { percentOff, duration, durationInMonths, code, maxRedemptions, expiresAt } = request;
  if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 100) {
    problems.push({ field: "percentOff", message: "The discount must be between 1% and 100%" });
  }
  if (
    duration === "repeating" &&
    (durationInMonths === undefined ||
      !Number.isInteger(durationInMonths) ||
      durationInMonths < 1 ||
      durationInMonths > MAX_DURATION_MONTHS)
  ) {
    problems.push({ field: "durationInMonths", message: "Say how many months the discount lasts" });
  }
  if (!CODE_PATTERN.test(code)) {
    problems.push({
      field: "code",
      message: "Codes use letters, digits, dashes and underscores",
    });
  }
  if (maxRedemptions !== undefined && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    problems.push({ field: "maxRedemptions", message: "Allow at least one redemption" });
  }
  if (expiresAt !== undefined && !isFutureInstant(expiresAt, now)) {
    problems.push({ field: "expiresAt", message: "The expiry date must be in the future" });
  }
  return problems;
}

/** Whether `iso` names an instant after `now`; an unreadable date is not in the future. */
function isFutureInstant(iso: string, now: Instant): boolean {
  try {
    return Temporal.Instant.compare(Temporal.Instant.from(iso), now) > 0;
  } catch {
    return false;
  }
}
