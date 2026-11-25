// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  isMissingExternalIdError,
  isMissingKeyPairError,
} from "./security-lake-credentials.rules.ts";

const AWS_ERROR_CODE = /^[A-Za-z][A-Za-z0-9.]{0,63}$/;

/**
 * What a tenant may read about a failed AWS call: the error code only. The raw message names
 * principals, roles and buckets, which may be ours.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
export function describeAwsFailure(error: unknown): string {
  if (isMissingKeyPairError(error)) {
    return "The source has no access key pair; add the access key ID and secret access key.";
  }
  if (isMissingExternalIdError(error)) return error.message;
  const name = error instanceof Error ? error.name : undefined;
  const code = name !== undefined && name !== "Error" && AWS_ERROR_CODE.test(name) ? name : null;
  return code === null ? "The AWS request failed." : `The AWS request failed with ${code}.`;
}
