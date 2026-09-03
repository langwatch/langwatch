/**
 * The host patterns refused unconditionally, whatever the local-address policy
 * says.
 *
 * FROZEN TWIN of `platform/app/src/utils/ssrfConstants.ts`. Both lists are
 * literals here rather than a read of that file, because a list read across a
 * package boundary dies the moment either side moves and a list that silently
 * shrank is a credential-exfiltration path that still passes every test.
 *
 * Configured for AWS deployments. Other providers' metadata endpoints and
 * internal domains are listed in the twin's own documentation; extend both
 * sides together or the two processes disagree about which addresses are
 * reachable.
 */

/**
 * Cloud provider internal domain patterns to block.
 *
 * Matched as suffixes, so `.amazonaws.com` blocks `s3.amazonaws.com` and
 * `ec2.amazonaws.com` alike. Bare `localhost` and `local` are deliberately NOT
 * refused here — they are the local-address policy's business, which an
 * operator may relax.
 */
export const BLOCKED_CLOUD_DOMAINS = [
  // AWS internal domains
  ".amazonaws.com",
  ".aws.amazon.com",
  ".compute.internal", // AWS internal DNS for EC2 instances

  // Generic internal domains (catch-all for misconfigured services)
  ".internal",
  ".local",
  ".localhost",
] as const;

/**
 * Cloud metadata endpoint hostnames and IPs to block.
 *
 * These endpoints hand out instance credentials to anything that can reach
 * them, so they are refused regardless of every other setting.
 */
export const BLOCKED_METADATA_HOSTS = [
  // AWS EC2 Instance Metadata Service (IMDS)
  "169.254.169.254",
  // AWS EC2 IPv6 metadata endpoint
  "fd00:ec2::254",
  // AWS ECS/Fargate task metadata endpoint
  "169.254.170.2",
  // Generic metadata hostname (some systems use this)
  "metadata",
] as const;
