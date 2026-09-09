/**
 * The wire shapes the two REST doors publish. The `/api/me/usage` fields
 * mirror the `user.personalUsage` tRPC payload the /me dashboard consumes
 * one-to-one, camelCase included, so the two entrypoints cannot drift.
 */
import { z } from "zod";

// Max absolute epoch-ms representable by a JS `Date` (ECMA-262); anything
// beyond becomes `Invalid Date`, so bound the inputs before they reach
// `new Date(...)` downstream.
const MAX_DATE_MS = 8_640_000_000_000_000;
const epochMs = z.coerce.number().int().min(-MAX_DATE_MS).max(MAX_DATE_MS);

export const meUsageQuerySchema = z
  .object({
    /** Inclusive window start in epoch ms. Defaults to start-of-month. */
    windowStartMs: epochMs.optional(),
    /** Exclusive window end in epoch ms. Defaults to now. */
    windowEndMs: epochMs.optional(),
  })
  // A half-specified window is ambiguous - require both bounds or neither,
  // rather than silently dropping a lone bound and returning the default month.
  .refine((q) => (q.windowStartMs === undefined) === (q.windowEndMs === undefined), {
    message:
      "windowStartMs and windowEndMs must be provided together (or both omitted for the current month).",
  })
  .refine(
    (q) =>
      q.windowStartMs === undefined ||
      q.windowEndMs === undefined ||
      q.windowStartMs < q.windowEndMs,
    { message: "windowStartMs must be before windowEndMs." },
  );

const mostUsedModelSchema = z.object({ name: z.string(), usagePct: z.number() }).nullable();

const meUsageSummarySchema = z.object({
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  mostUsedModel: mostUsedModelSchema,
});

const meUsageBucketSchema = z.object({
  day: z.string(),
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
});

const meUsageBreakdownSchema = z.object({
  label: z.string(),
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
});

export const meUsageResponseSchema = z.object({
  summary: meUsageSummarySchema,
  dailyBuckets: z.array(meUsageBucketSchema),
  breakdownByModel: z.array(meUsageBreakdownSchema),
});

export type MeUsage = z.infer<typeof meUsageResponseSchema>;

/**
 * The identity of the project the calling API key belongs to. The CLI's
 * identity notice names the project behind LANGWATCH_API_KEY with it.
 */
export const meProjectResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  isPersonal: z.boolean(),
});

export type MeProject = z.infer<typeof meProjectResponseSchema>;

/**
 * The credential `/api/me` resolved, as the mounting process reads it. The
 * key's CLASS is half the decision - a service key belongs to nobody and must
 * not be read as a personal workspace's own legacy key - so it travels whole.
 */
export const mePersonalCredentialSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("apiKey"),
    userId: z.string().nullable(),
    organizationId: z.string().nullable(),
  }),
  z.object({ kind: z.literal("legacyProjectKey") }),
]);

export type MePersonalCredential = z.infer<typeof mePersonalCredentialSchema>;

/** Who the avatar door's dual-credential verifier let in. */
export const userAvatarCallerSchema = z.object({
  apiKeyProjectId: z.string().nullable(),
  userId: z.string().nullable(),
});

export type UserAvatarCaller = z.infer<typeof userAvatarCallerSchema>;
