/**
 * How a queue endpoint proves it may write to the queue it names.
 *
 * Three modes, in the order we would like customers to pick them:
 *
 * 1. **assume-role** — the customer's role, with an ExternalId we generate
 *    and they paste into the trust policy. The only mode we market, because
 *    it is the only one where nothing long-lived is stored anywhere and the
 *    customer can revoke us by editing their own trust policy.
 * 2. **static keys** — an access key pair, encrypted at rest with the same
 *    path the signing secret uses. For deployments that cannot create a
 *    cross-account role.
 * 3. **ambient** — the deployment's own identity (IRSA, an instance profile,
 *    a developer's SSO session). This is the self-hosted and dogfood path,
 *    and it is GATED, because a queue endpoint on ambient credentials can
 *    write to any queue the deployment's role can write to. On a shared
 *    deployment that is one tenant naming another tenant's queue, or ours.
 *
 * The gate mirrors the local-URL escape hatch (`WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS`)
 * that lets a webhook be pointed at a loopback receiver: same reasoning, same
 * spelling, same "unsafe" in the name so nobody sets it without reading it.
 */

export const AMBIENT_CREDENTIALS_FLAG =
  "WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS";

/**
 * Whether this deployment lets a queue endpoint run on the deployment's OWN
 * AWS identity rather than credentials the customer supplied.
 *
 * Off by default, and off is the correct answer for any deployment serving
 * more than one organization.
 */
export function allowsAmbientAwsCredentials(): boolean {
  return process.env[AMBIENT_CREDENTIALS_FLAG] === "1";
}

/** Which of the three modes an endpoint's stored fields amount to. Derived,
 *  never stored, so it can never disagree with the fields. */
export type SqsCredentialMode = "assume_role" | "static" | "ambient";

export function sqsCredentialMode({
  roleArn,
  accessKeyId,
}: {
  roleArn: string | null | undefined;
  accessKeyId: string | null | undefined;
}): SqsCredentialMode {
  if (roleArn) return "assume_role";
  if (accessKeyId) return "static";
  return "ambient";
}

/**
 * An IAM role ARN, in the one shape a role ARN has. Checked at save time so
 * a typo is a 400 rather than an AccessDenied on the first delivery.
 */
const ROLE_ARN_PATTERN =
  /^arn:aws(?:-cn|-us-gov)?:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/;

export function isRoleArn(value: string): boolean {
  return ROLE_ARN_PATTERN.test(value.trim());
}
