/**
 * The three answers to "who gets in", said once.
 *
 * ONE QUESTION, TWO DOORS. People arriving THROUGH a connection are answered
 * by that connection's arrivals setting (ADR-117 §3); people arriving without
 * single sign-on are answered by the organization's join policy (D12). They
 * are genuinely different settings about different populations, so they stay
 * two controls — but they are the same question, and a reader who has
 * answered one should recognise the other on sight.
 *
 * Both surfaces claimed that in a comment and neither held it. The labels
 * matched; the ORDER was mirrored — one ran open-to-closed and the other
 * closed-to-open — and the help lines carried different facts about the same
 * answer, so the option a reader had already chosen described itself
 * differently in the second place. Shape is what somebody recognises a list
 * by, and a list of three reversed is a different list.
 *
 * So the answers, their order and their words live here and the two cards
 * render them. The two settings have different value enums, which is correct —
 * neither should be typed in terms of the other — so each card maps its own
 * enum onto these and nothing shared has to know either.
 *
 * WHAT IS NOT SHARED: which answer is recommended. It is the usual answer on
 * a connection, where routing already bounds it to a domain somebody proved,
 * and it is a bigger step on the open door, where nothing does. So the
 * endorsement is the caller's and only the connection's card passes it.
 */

import type { SsoArrivalPolicy } from "@langwatch/identity";

/**
 * An answer, in neither setting's vocabulary.
 *
 * Ordered closed to open, the direction that reads as widening a door — and
 * the direction that puts the answer somebody should choose deliberately at
 * the end rather than first.
 */
export type ArrivalAnswer = "closed" | "approve" | "open";

export const ARRIVAL_ANSWERS: readonly ArrivalAnswer[] = [
  "closed",
  "approve",
  "open",
] as const;

export interface ArrivalAnswerCopy {
  label: string;
  /** What the answer means ON THE CONNECTION DOOR. The labels are the shared
   *  vocabulary; the help describes mechanics, and the join policy's
   *  mechanics differ (no account carried over, a domain box of its own), so
   *  that card writes its own help under the shared labels. */
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
  // BOTH HALVES, in both places. One card sold this answer — "only addresses
  // on a domain you verified ever reach it" — and the other warned about it —
  // "nobody approves each person". Each was true and each was half, so a
  // reader comparing them learned that one option meant two things.
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
 * The CONNECTION door's own enum, against the shared answers.
 *
 * This mapping lives here rather than in each card because three surfaces
 * read it — the arrivals step, the journey's closed-step summary, and the
 * overview's read-only row — and they are all the same door. The join
 * policy's `DomainJoinSetting` mapping stays in its own card: a module that
 * knew both enums would be the place they eventually get confused.
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
