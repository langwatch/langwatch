import { z } from "zod";

/**
 * What a flag is being resolved for; union ensures callers pass only the
 * identifiers their targeting rules can match.
 */
export const authenticatedFeatureFlagTargetInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project"),
    projectId: z.string().min(1),
    organizationId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("organization"),
    organizationId: z.string().min(1),
  }),
  z.object({ kind: z.literal("user") }),
]);

export const anonymousFeatureFlagTargetSchema = z.object({
  kind: z.literal("anonymous"),
  anonymousId: z.string().uuid(),
});

export const featureFlagTargetInputSchema = z.union([
  authenticatedFeatureFlagTargetInputSchema,
  anonymousFeatureFlagTargetSchema,
]);

export type AuthenticatedFeatureFlagTargetInput = z.infer<
  typeof authenticatedFeatureFlagTargetInputSchema
>;
export type FeatureFlagTargetInput = z.infer<typeof featureFlagTargetInputSchema>;

/**
 * A project always resolves within its organization, so an organization
 * rule applies to it too. The system target carries no identity at all and
 * is for backend kill switches with no tenant, never a stand-in for one.
 */
export type FeatureFlagTarget =
  | {
      kind: "project";
      projectId: string;
      organizationId?: string;
      userId?: string;
      userEmail?: string;
    }
  | { kind: "organization"; organizationId: string; userId?: string; userEmail?: string }
  | { kind: "user"; userId: string; userEmail?: string }
  | { kind: "anonymous"; anonymousId: string }
  | { kind: "system" };

/**
 * The identity a resolution is recorded against. The system target has no
 * user, and says so rather than borrowing one.
 */
export const SYSTEM_DISTINCT_ID = "system";

export function distinctIdForTarget(target: FeatureFlagTarget): string {
  if (target.kind === "system") return SYSTEM_DISTINCT_ID;
  if (target.kind === "anonymous") return target.anonymousId;
  if (target.kind === "user") return target.userId;
  if (target.kind === "project") return target.userId ?? target.projectId;
  return target.userId ?? target.organizationId;
}

/**
 * The identity a percentage rule buckets on: user id for a signed-in
 * person (same in every browser), anonymous browser id for a visitor,
 * undefined for a system target, which a percentage rule never admits.
 */
export function pickBucketingId(target: FeatureFlagTarget): string | undefined {
  if (target.kind === "system") return undefined;
  if (target.kind === "anonymous") return target.anonymousId;
  return target.userId;
}

export function projectIdForTarget(target: FeatureFlagTarget): string | undefined {
  return target.kind === "project" ? target.projectId : undefined;
}

export function pickTargetOrganizationId(target: FeatureFlagTarget): string | undefined {
  if (target.kind === "project" || target.kind === "organization") {
    return target.organizationId;
  }
  return undefined;
}

export function ruleContextForTarget(target: FeatureFlagTarget): {
  projectId?: string;
  organizationId?: string;
  bucketingId?: string;
  userEmail?: string;
} {
  const userEmail =
    target.kind === "anonymous" || target.kind === "system" ? void 0 : target.userEmail;

  return {
    projectId: projectIdForTarget(target),
    organizationId: pickTargetOrganizationId(target),
    bucketingId: pickBucketingId(target),
    userEmail,
  };
}
