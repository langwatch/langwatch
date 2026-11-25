// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

const ROLE_ARN =
  /^arn:(aws[a-z-]*):(?:iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*([\w+=,.@-]+)|sts::(\d{12}):assumed-role\/([\w+=,.@-]+)\/[\w+=,.@-]+)$/;

interface AwsRole {
  partition: string;
  accountId: string;
  roleName: string;
}

function parseAwsRole(arn: string): AwsRole | undefined {
  const match = ROLE_ARN.exec(arn);
  if (!match) return void 0;
  const [, partition = "aws", iamAccount, iamRole, stsAccount, stsRole] = match;
  const accountId = iamAccount ?? stsAccount;
  const roleName = iamRole ?? stsRole;
  if (!accountId || !roleName) return void 0;
  return { partition, accountId, roleName };
}

/**
 * The identity two principal ARNs share when they name the same role: an IAM role ARN and
 * any STS assumed-role session of it give the same key. Any other ARN is its own key.
 */
export function awsPrincipalKey(arn: string): string {
  const role = parseAwsRole(arn);
  return role ? `${role.partition}:${role.accountId}:role/${role.roleName}` : arn;
}

/**
 * How a trace's ARN is matched to this principal: exact `values` (the ARN and its IAM role
 * form) and `prefixes` (any session of the role, and the account's IAM roles so a role with a
 * path matches). Prefixes over-match; callers compare `awsPrincipalKey` of what comes back.
 */
export function awsPrincipalMatch(arn: string): { values: string[]; prefixes: string[] } {
  const role = parseAwsRole(arn);
  if (!role) return { values: [arn], prefixes: [] };
  const roleArn = `arn:${role.partition}:iam::${role.accountId}:role/${role.roleName}`;
  return {
    values: roleArn === arn ? [arn] : [arn, roleArn],
    prefixes: [
      `arn:${role.partition}:sts::${role.accountId}:assumed-role/${role.roleName}/`,
      `arn:${role.partition}:iam::${role.accountId}:role/`,
    ],
  };
}
