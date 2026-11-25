// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SecurityLakePullConfig } from "@langwatch/enterprise-governance-contract";

import type { GovernanceObjectStorageCredentials } from "../../../channels/object-store.channel.ts";

/** An endpoint on an AWS domain (a regional, FIPS or VPC endpoint), where the subscriber role applies. */
export function isAwsHostedEndpoint(endpoint: string): boolean {
  return /(^|\.)amazonaws\.com(\.cn)?$/i.test(new URL(endpoint).hostname);
}

/** The sealed credentials key that holds the external id LangWatch generated for the source. */
export const SECURITY_LAKE_EXTERNAL_ID_KEY = "external_id";

/** Named as aws-client names its own refusal, so one check covers the SDK's and this one. */
const MISSING_KEY_PAIR_ERROR = "MissingStaticAwsCredentialsError";

function missingKeyPairError(): Error {
  const error = new Error("An access key ID and secret access key are required");
  error.name = MISSING_KEY_PAIR_ERROR;
  return error;
}

export function isMissingKeyPairError(error: unknown): error is Error {
  return error instanceof Error && error.name === MISSING_KEY_PAIR_ERROR;
}

/** The name of the error a source without its generated external id is refused with. */
const MISSING_EXTERNAL_ID_ERROR = "MissingSecurityLakeExternalIdError";

function missingExternalIdError(): Error {
  const error = new Error("The Security Lake source has no external id; add it again to get one");
  error.name = MISSING_EXTERNAL_ID_ERROR;
  return error;
}

export function isMissingExternalIdError(error: unknown): error is Error {
  return error instanceof Error && error.name === MISSING_EXTERNAL_ID_ERROR;
}

export function securityLakeCredentialsOf(
  credentials: Record<string, string> | undefined,
  config: Pick<SecurityLakePullConfig, "subscriberRoleArn" | "s3Endpoint" | "sqsEndpoint">,
): GovernanceObjectStorageCredentials {
  const accessKeyId = credentials?.aws_access_key_id?.trim();
  const secretAccessKey = credentials?.aws_secret_access_key?.trim();
  // Without the source's own pair the SDK would sign with the worker's identity.
  if (!accessKeyId || !secretAccessKey) throw missingKeyPairError();
  // Only an emulator for both stores (no STS) signs with the keys directly; one store left on AWS
  // keeps the role and its external id, since the credentials serve both.
  const emulated = [config.s3Endpoint, config.sqsEndpoint].every(
    (endpoint) => endpoint !== undefined && !isAwsHostedEndpoint(endpoint),
  );
  const externalId = credentials?.[SECURITY_LAKE_EXTERNAL_ID_KEY]?.trim();
  if (!emulated && !externalId) throw missingExternalIdError();
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: credentials?.aws_session_token?.trim() || undefined,
    requireStaticKeys: true,
    ...(emulated ? {} : { assumeRole: { roleArn: config.subscriberRoleArn, externalId } }),
  };
}
