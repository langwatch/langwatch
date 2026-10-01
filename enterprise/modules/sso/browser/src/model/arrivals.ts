// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The three answers to "who gets in", said once, so the connection's card and
 * the organization's join-policy card offer one list in one order. The two
 * settings keep their own enums; each maps onto these answers (ADR-117 §3).
 */

import type { SsoArrivalPolicy } from "@langwatch/identity-contract";

/**
 * An answer in neither setting's vocabulary, ordered closed to open: the
 * direction that reads as widening a door, and the one that puts the
 * deliberate choice last rather than first.
 */
export type ArrivalAnswer = "closed" | "approve" | "open";

export const ARRIVAL_ANSWERS: readonly ArrivalAnswer[] = ["closed", "approve", "open"] as const;

export interface ArrivalAnswerCopy {
  label: string;
  /** What the answer means on the CONNECTION door. The labels are shared; the
   *  join policy's mechanics differ, so that card writes its own help. */
  help: string;
}

export const ARRIVAL_COPY: Record<ArrivalAnswer, ArrivalAnswerCopy> = {
  closed: {
    label: "Only people already here",
    help: "Anybody else is turned away. Invitations still work.",
  },
  approve: {
    label: "They ask, you approve",
    help: "They keep the account they signed in with, and you answer the request in your Directory.",
  },
  open: {
    label: "They join, on a domain you verified",
    help: "Nobody approves each person. Only addresses on a domain you verified ever reach it, and you are emailed each time.",
  },
};

/** The label alone — what a finished step says it decided. */
export function arrivalAnswerLabel(answer: ArrivalAnswer): string {
  return ARRIVAL_COPY[answer].label;
}

/**
 * The connection door's own enum against the shared answers. Three surfaces
 * read it — the arrivals step, the journey's closed-step summary and the
 * overview row — and the join policy's mapping stays in its own card.
 */
export const SSO_POLICY_BY_ANSWER: Record<ArrivalAnswer, SsoArrivalPolicy> = {
  closed: "refuse",
  approve: "request",
  open: "admit",
};

export const SSO_ANSWER_BY_POLICY: Record<SsoArrivalPolicy, ArrivalAnswer> = {
  refuse: "closed",
  request: "approve",
  admit: "open",
};

/**
 * What a control hands back is a string, and a door is never widened by one
 * we do not recognise: a caller that cannot narrow leaves its answer alone.
 */
export function isSsoArrivalPolicy(value: string | null | undefined): value is SsoArrivalPolicy {
  return value === "refuse" || value === "request" || value === "admit";
}
