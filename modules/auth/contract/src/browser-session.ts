import { z } from "zod";

const browserSessionUserSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    pendingSsoSetup: z.boolean().optional(),
  })
  .strict();

/**
 * Projection of Better Auth's verified session. Not strict to avoid rejecting
 * valid sessions when additionalFields are present.
 */
const verifiedBrowserSessionUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  pendingSsoSetup: z.boolean().optional(),
});

export const verifiedBrowserSessionSchema = z.object({
  session: z.object({ id: z.string().min(1), expiresAt: z.coerce.date() }),
  user: verifiedBrowserSessionUserSchema,
});
export type VerifiedBrowserSession = z.infer<typeof verifiedBrowserSessionSchema>;

const browserSessionActorSchema = browserSessionUserSchema.pick({
  id: true,
  name: true,
  email: true,
  image: true,
});

export const browserSessionSchema = z
  .object({
    user: browserSessionUserSchema.safeExtend({
      impersonator: browserSessionActorSchema.optional(),
    }),
    expires: z.string().datetime(),
    sessionId: z.string().min(1),
  })
  .strict();
export type BrowserSession = z.infer<typeof browserSessionSchema>;

export const browserSessionImpersonationSchema = browserSessionActorSchema
  .safeExtend({ expires: z.coerce.date() })
  .strict();
export type BrowserSessionImpersonation = z.infer<typeof browserSessionImpersonationSchema>;

/**
 * One session as its owner reads it on their devices list. Carries how it
 * signed in and what that proved, never a token: the list is a reading of
 * live sessions, and nothing on it can be replayed.
 */
export const browserSessionInventoryEntrySchema = z
  .object({
    sessionId: z.string().min(1),
    /** Which sign-in method minted it; null on every session predating it. */
    identifierId: z.string().nullable(),
    /** How it signed in, in words — never `pwd` or `phw`. */
    method: z.string().min(1),
    secondFactorProven: z.boolean(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    signedInAt: z.string().datetime(),
    /**
     * Activity to the nearest day: better-auth rolls a live session's expiry
     * once per `updateAge`, so this tells a browser used this morning from one
     * untouched since February, which is the only question asked of it.
     */
    lastActiveAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    /** Whether this is the session doing the reading. */
    current: z.boolean(),
  })
  .strict();
export type BrowserSessionInventoryEntry = z.infer<typeof browserSessionInventoryEntrySchema>;
