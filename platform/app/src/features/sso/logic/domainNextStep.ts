/**
 * What the reader does next about one domain, in one place.
 *
 * WHY THIS IS A TABLE AND NOT A CONDITION IN A CELL. The row used to offer
 * the record only on an APPROVED claim. On the hosted service a claim is not
 * approved BY A PERSON at all — publishing the record is what decides it, and
 * the service accepts a request to prove a WAITING claim for exactly that
 * reason. So the one path almost every customer takes rendered a row with a
 * status, no button, and no sentence saying what to do: the journey stopped
 * dead at step two with the screen insisting nothing was wrong.
 *
 * A NEXT STEP IS NEVER ABSENT. Every state answers "and now what", including
 * the two where the answer is "nothing, it is ours to do" and "nothing, this
 * one is finished". A blank cell is read as a broken page, and the reader is
 * usually right.
 *
 * Framework-free, so the decision is pinned by a test that renders nothing.
 */

export type DomainNextStepKind =
  /** Ask for the value to publish. Ours to hand over, theirs to publish. */
  | "get-record"
  /** A value is already out. Publishing it is theirs, and asking again
   *  would replace the one they are working from. */
  | "publish-it"
  /** A person here is deciding it, because another organization holds it. */
  | "waiting-on-us"
  /** Refused. It can be claimed again without a second connection. */
  | "claim-again"
  /** Proved, and the evidence is still there. */
  | "done"
  /** Proved, but we cannot find the evidence any more. */
  | "republish";

export interface DomainNextStep {
  kind: DomainNextStepKind;
  /** The button's words, or null when there is nothing to press. */
  action: string | null;
  /** What is going on, said to somebody who has never done this before. */
  explanation: string;
}

export function domainNextStepFor({
  proved,
  proofState,
  claim,
  provesWithLicense,
  recordIssued = false,
}: {
  proved: boolean;
  proofState: "VERIFIED" | "WAVERING" | "LAPSED";
  claim: { state: "WAITING" | "APPROVED" | "REJECTED"; waitsForReview: boolean }
    | undefined;
  /** A licensed installation proves with its licence, in one press, with no
   *  record to publish anywhere. */
  provesWithLicense: boolean;
  /** Whether a value has already been handed over for THIS domain and is
   *  waiting to be published. */
  recordIssued?: boolean;
}): DomainNextStep {
  if (proved && proofState !== "VERIFIED") {
    return {
      kind: "republish",
      action: "Get a fresh record",
      explanation:
        "We can no longer find the record that proved this domain. People already here still sign in as usual. Publish it again and this goes back to normal.",
    };
  }
  if (proved) {
    return {
      kind: "done",
      action: null,
      explanation:
        "This domain is proved. Anyone with an address at it can be sent to your identity provider.",
    };
  }
  if (claim?.state === "REJECTED") {
    return {
      kind: "claim-again",
      action: "Claim it again",
      explanation:
        "This claim was not approved. You can claim the domain again — you do not need to start the connection over.",
    };
  }
  // The only claim a PERSON here decides is one on a domain another
  // organization already proved. Everything else is the reader's move.
  if (claim?.state === "WAITING" && claim.waitsForReview) {
    return {
      kind: "waiting-on-us",
      action: null,
      explanation:
        "Another organization has already proved this domain, so somebody here is deciding this claim by hand. There is nothing for you to do until we come back to you.",
    };
  }
  // A VALUE ALREADY HANDED OVER IS NOT A STEP TO REPEAT. Asking to prove
  // again MINTS A NEW TOKEN and the old one stops counting, so a row that
  // kept offering "Prove this domain" would invite somebody who had already
  // published the value into silently invalidating it — and the record they
  // are staring at in their DNS console would quietly become the wrong one.
  // The move at this point is theirs and it is outside LangWatch.
  if (recordIssued && !provesWithLicense) {
    return {
      kind: "publish-it",
      action: null,
      explanation:
        "We have given you a value for this domain. Publish it, then use the check below. Asking to prove again replaces it with a new value, which would make anything you have already published stop counting.",
    };
  }
  return {
    kind: "get-record",
    action: provesWithLicense ? "Prove with our licence" : "Prove this domain",
    explanation: provesWithLicense
      ? "This installation's enterprise licence is what proves the domain, so this finishes in one press and there is nothing to publish anywhere."
      : "Next you prove the domain is yours. We give you a short value to publish in your domain's DNS — or as a file on your website — and then we look for it.",
  };
}
