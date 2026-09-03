/**
 * The generated Prisma shapes this package names, restated.
 *
 * `~/generated/prisma/client` is the application's generated client and a
 * browser package may not reach it. Each value below is an ENUM the product
 * offers in a picker or compares a membership against, and each type is the row
 * shape a moved surface renders — restated here with the alignment obligation
 * `@langwatch/enterprise-billing-contract` states about its own Prisma enum
 * copies: these must stay identical to `schema.prisma` or a role stops
 * matching and a scope stops resolving.
 *
 * Neither `@langwatch/authz-contract` nor `@langwatch/annotation-contract`
 * publishes the enum VALUES today — the RBAC family's manifest records
 * `OrganizationUserRole` as the one with no home at all — so the restatement is
 * here rather than an import.
 */

export const TeamUserRole = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
} as const;
export type TeamUserRole = (typeof TeamUserRole)[keyof typeof TeamUserRole];

export const OrganizationUserRole = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  EXTERNAL: "EXTERNAL",
} as const;
export type OrganizationUserRole = (typeof OrganizationUserRole)[keyof typeof OrganizationUserRole];

export const RoleBindingScopeType = {
  ORGANIZATION: "ORGANIZATION",
  TEAM: "TEAM",
  PROJECT: "PROJECT",
  PLATFORM: "PLATFORM",
} as const;
export type RoleBindingScopeType = (typeof RoleBindingScopeType)[keyof typeof RoleBindingScopeType];

export const AnnotationScoreDataType = {
  OPTION: "OPTION",
  CHECKBOX: "CHECKBOX",
  BOOLEAN: "BOOLEAN",
  LIKERT: "LIKERT",
  CATEGORICAL: "CATEGORICAL",
} as const;
export type AnnotationScoreDataType =
  (typeof AnnotationScoreDataType)[keyof typeof AnnotationScoreDataType];

/** The project row, as the surfaces that moved read it. */
export type Project = {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
  teamId: string;
  language: string;
  framework: string;
  firstMessage: boolean;
  integrated: boolean;
  createdAt: Date;
  updatedAt: Date;
  piiRedactionLevel?: string;
  s3Endpoint?: string | null;
  capturedInputVisibility?: string;
  capturedOutputVisibility?: string;
  defaultModel?: string | null;
  embeddingsModel?: string | null;
  topicClusteringModel?: string | null;
  userLinkTemplate?: string | null;
};
