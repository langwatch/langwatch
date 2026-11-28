// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The advisory lock key a connection delete and a plan write naming a Bedrock target both take,
 * so a delete's in-use check and a plan naming the connection never interleave.
 */
export function awsConnectionsLockKey(organizationId: string): string {
  return `governance-aws-connections:${organizationId}`;
}
