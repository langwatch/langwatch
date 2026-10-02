import type { Project } from "~/generated/prisma/client";

/**
 * Prisma `omit` for Project rows that leave the server in a payload a browser
 * reads. Credentials stay on the server: the project key and its hash, the
 * LangWatchQL key, and the S3 credentials.
 */
export const PROJECT_SECRET_FIELDS_OMIT = {
  apiKey: true,
  apiKeyHash: true,
  apiKeyHashedAt: true,
  lwqlKey: true,
  s3AccessKeyId: true,
  s3SecretAccessKey: true,
} as const;

/** A Project row as it reaches the browser: no credential columns. */
export type ProjectWithoutSecrets = Omit<
  Project,
  keyof typeof PROJECT_SECRET_FIELDS_OMIT
>;
