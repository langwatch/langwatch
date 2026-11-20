// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { moduleApi } from "@langwatch/module";
import type { OpsOperator } from "@langwatch/ops-contract";

import type {
  DigestSendTestInput,
  DigestSetArmedInput,
  DigestSetEnrolledInput,
  DigestSettings,
  DigestTokenCall,
} from "./digest.ts";

type Operated = Readonly<{ operator: OpsOperator | null }>;

/**
 * The weekly digest. The operator controls admit Cloud admin staff through
 * `OpsApi.admitCloudAdmin`, so they answer not_found where cloud ops is off (§3.5); the token
 * operations serve the public unsubscribe address, whose signed token is the authorization.
 */
export interface DigestApi {
  setEnrolled(input: DigestSetEnrolledInput & Operated): Promise<DigestSettings>;
  setArmed(input: DigestSetArmedInput & Operated): Promise<DigestSettings>;
  /** Mails the member's week to the operator alone; no send is recorded. */
  sendTest(input: DigestSendTestInput & Operated): Promise<void>;

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
