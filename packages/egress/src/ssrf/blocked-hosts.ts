/**
 * The host patterns refused whatever the local-address policy says. The Go scenario runner
 * carries the same lists in `services/scenariorunner/egress/validator.go`; change both together.
 */

/**
 * The BLOCKED_CLOUD_DOMAINS suffixes the allowlist may lift for one exact host: private
 * infrastructure, no ambient credentials. Every other suffix stays refused before the allowlist
 * is read. Extend only with suffixes meaningless outside a private network.
 */
export const ON_PREMISE_SUFFIXES = [".local", ".localhost"] as const;

/**
 * Cloud provider internal domain patterns to block. Matched as suffixes, so `.amazonaws.com`
 * blocks `s3.amazonaws.com` and `ec2.amazonaws.com` alike.
 */
export const BLOCKED_CLOUD_DOMAINS = [
  // AWS internal domains
  ".amazonaws.com",
  ".aws.amazon.com",
  ".compute.internal", // AWS internal DNS for EC2 instances

  // Generic internal domains (catch-all for misconfigured services)
  ".internal",

  // Blocked by default; ALLOWED_PROXY_HOSTS may name one exact host under them.
  ...ON_PREMISE_SUFFIXES,
] as const;

/**
 * Cloud metadata endpoint hostnames and IPs to block. These endpoints hand out instance
 * credentials to anything that can reach them, so they are refused regardless of every other
 * setting.
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
  // GCP instance metadata server, by both of the names it answers to
  "metadata.google.internal",
  "metadata.goog",
] as const;
