import { z } from "zod";

/**
 * What a flag is being resolved for.
 *
 * The union is explicit so a caller cannot resolve a project-targeted flag
 * by inventing an organization id, or reach a backend kill switch by
 * passing a placeholder identity. Every variant carries exactly the
 * identifiers its targeting rules can match on, and no more.
 *
 * `userId` is not part of the transport input: an authenticated transport
 * derives it from the caller, never from the request body.
 */
export const featureFlagTargetInputSchema = z.discriminatedUnion("kind", [
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
  z.object({
    kind: z.literal("anonymous"),
    // A v4 UUID from the browser's own crypto. The format check is also the
    // length bound: nothing longer or shorter reaches the resolver.
    anonymousId: z.string().uuid(),
  }),
]);

export type FeatureFlagTargetInput = z.infer<typeof featureFlagTargetInputSchema>;

/**
 * A project always resolves within its organization, so an organization
 * rule applies to it too. The system target carries no identity at all and
 * is for backend kill switches with no tenant, never a stand-in for one.
 */
export type FeatureFlagTarget =
  | { kind: "project"; userId: string; projectId: string; organizationId: string }
  | { kind: "organization"; userId: string; organizationId: string }
  | { kind: "user"; userId: string }
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
  return target.userId;
}

/**
 * The identity a percentage rule buckets on.
 *
 * A signed-in person buckets by user id, so their rollout answer is the same
 * in every browser. A visitor who is not signed in buckets by the anonymous
 * browser id. A system target has neither and returns undefined, so a
 * percentage rule never admits it.
 */
export function bucketingIdForTarget(target: FeatureFlagTarget): string | undefined {
  if (target.kind === "system") return undefined;
  if (target.kind === "anonymous") return target.anonymousId;
  return target.userId;
}

export function projectIdForTarget(target: FeatureFlagTarget): string | undefined {
  return target.kind === "project" ? target.projectId : undefined;
}

export function organizationIdForTarget(target: FeatureFlagTarget): string | undefined {
  if (target.kind === "project" || target.kind === "organization") {
    return target.organizationId;
  }
  return undefined;
}
