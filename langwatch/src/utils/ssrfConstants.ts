/**
 * SSRF Protection Constants
 *
 * These constants define which cloud provider domains and metadata endpoints
 * should be blocked to prevent Server-Side Request Forgery (SSRF) attacks.
 *
 * ## Why This Matters
 *
 * When an application runs inside a cloud environment, it can access internal
 * metadata services that expose sensitive information (IAM credentials, API keys,
 * instance identity). SSRF attacks trick the server into making requests to these
 * internal endpoints on the attacker's behalf.
 *
 * ## Current Configuration
 *
 * This is configured for AWS-only deployments. If you deploy LangWatch to other
 * cloud providers, extend these arrays accordingly.
 *
 * ## How to Extend
 *
 * 1. Identify your cloud provider's metadata endpoint IPs/hostnames
 * 2. Identify internal domain patterns that could expose services
 * 3. Add them to the appropriate array below
 *
 * Common cloud provider metadata endpoints:
 * - AWS:    169.254.169.254, fd00:ec2::254, 169.254.170.2 (ECS)
 * - GCP:    metadata.google.internal, metadata.goog
 * - Azure:  169.254.169.254, 168.63.129.16
 * - Oracle: 169.254.169.254
 *
 * Common cloud provider internal domains:
 * - AWS:    .amazonaws.com, .aws.amazon.com, .compute.internal
 * - GCP:    .googleapis.com, .cloud.google.com, .run.app, .cloudfunctions.net
 * - Azure:  .azure.com, .azurewebsites.net, .windows.net, .azure-api.net
 * - Oracle: .oraclecloud.com
 */

/**
 * Cloud provider internal domain patterns to block.
 *
 * These domains may expose unauthenticated internal services when accessed
 * from within the cloud environment. Patterns are matched as suffixes,
 * e.g., ".amazonaws.com" blocks "s3.amazonaws.com", "ec2.amazonaws.com", etc.
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
];

/**
 * Cloud metadata endpoint hostnames and IPs to block.
 *
 * These endpoints provide instance metadata including credentials.
 * They should ALWAYS be blocked regardless of environment.
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
];
