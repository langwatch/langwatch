// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type DIGEST_MY_TEST_SKIP_REASONS,
  DigestMemberNotFoundError,
  DigestMemberUnsubscribedError,
  DigestNothingToSendError,
} from "@langwatch/enterprise-digest-contract";

export type DigestMyTestSkipReason = (typeof DIGEST_MY_TEST_SKIP_REASONS)[number];

/**
 * The skip a test's refusal stands for when an operator sends themself every organization's
 * digest; undefined when the refusal is a real failure, which is not a skip.
 */
export function classifyDigestTestRefusal(error: unknown): DigestMyTestSkipReason | undefined {
  if (error instanceof DigestNothingToSendError) return "nothing_to_send";
  if (error instanceof DigestMemberUnsubscribedError) return "opted_out";
  if (error instanceof DigestMemberNotFoundError) return "not_a_member";
  return undefined;
}
