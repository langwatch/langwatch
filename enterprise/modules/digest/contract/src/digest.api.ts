// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { moduleApi } from "@langwatch/module";
import type { OpsOperator } from "@langwatch/ops-contract";

import type {
  DigestMyTests,
  DigestSendTestForInput,
  DigestSendTestInput,
  DigestSetArmedInput,
  DigestPreference,
  DigestSettings,
  DigestTestsFor,
  DigestTokenCall,
} from "./digest.ts";

type Operated = Readonly<{ operator: OpsOperator | null }>;

/**
 * The weekly digest, sent to every organization's members. The operator controls admit Cloud admin staff through
 * `OpsApi.admitCloudAdmin`, so they answer not_found where cloud ops is off (§3.5); the token
 * operations serve the public unsubscribe address, whose signed token is the authorization.
 */
export interface DigestApi {
  setArmed(input: DigestSetArmedInput & Operated): Promise<DigestSettings>;
  /** Mails the member's week to the operator alone; no send is recorded. */
  sendTest(input: DigestSendTestInput & Operated): Promise<void>;
  /**
   * Mails the operator, as a test, their own week in every organization they are an active
   * member of; an organization with nothing to send is skipped and reported, not refused.
   */
  sendMyTests(input: Operated): Promise<DigestMyTests>;
  /**
   * Mails the operator, or with `deliverTo: "person"` the person at their own address, as tests,
   * the person's week in each organization they are an active member of: what they would get,
   * or every row with data ("every-row"), skipped where it has none. An address no account has is refused
   * with `digest_person_not_found`.
   */
  sendTestFor(input: DigestSendTestForInput & Operated): Promise<DigestTestsFor>;

  /** The signed-in person's own choice; the caller names themselves, never anyone else. */
  getPreference(input: Readonly<{ userId: string }>): Promise<DigestPreference>;
  /**
   * Opts the signed-in person in or out of every organization's digest at once. Staff
   * impersonating them (`impersonatorId`) are refused with `digest_impersonation_refused`.
   */
  setPreference(
    input: Readonly<{ userId: string; impersonatorId?: string | undefined } & DigestPreference>,
  ): Promise<DigestPreference>;

  /**
   * Whether the person the token names still receives the digest. Each of the three token
   * operations counts one attempt per caller before anything is read, and refuses past the
   * limit with `digest_unsubscribe_rate_limited`.
   */
  isSubscribed(input: DigestTokenCall): Promise<boolean>;
  /** Opts the person out and records the send the link came from; asking twice changes nothing. */
  unsubscribe(input: DigestTokenCall): Promise<void>;
  /** Opts the person back in, from the same link. */
  resubscribe(input: DigestTokenCall): Promise<void>;
}

export const DigestApi = moduleApi<DigestApi>()("digest");
