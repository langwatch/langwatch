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
 * What this feature reads off Better Auth's verified session.
 *
 * Deliberately NOT `.strict()`, unlike every other schema in this file. The
 * others describe objects we build; this one is a PROJECTION of a record we do
 * not own. `getSession` answers Better Auth's whole session and user rows —
 * `token`, `userId`, `createdAt`, `updatedAt`, `ipAddress`, `userAgent`,
 * `emailVerified`, plus every `additionalFields` entry the transport configures
 * (`pendingSsoSetup`, `deactivatedAt`, `lastLoginAt`, `impersonating`) — and
 * the composition hands that result through unreshaped, behind an
 * `as unknown as BetterAuthSessionLookup` cast that keeps the compiler out of
 * it. Strict here threw `unrecognized_keys` on EVERY signed-in request;
 * `authenticate` caught it and answered null, so a signed-in caller was served
 * as an anonymous one with nothing in the logs to say a credential had been
 * presented. A plain object still narrows — the parsed value carries only the
 * keys below and drops the rest, which is the whole job. Widening the key list
 * to match Better Auth's would only re-break on its next added column.
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
    user: browserSessionUserSchema.extend({
      impersonator: browserSessionActorSchema.optional(),
    }),
    expires: z.string().datetime(),
    sessionId: z.string().min(1),
  })
  .strict();
export type BrowserSession = z.infer<typeof browserSessionSchema>;

export const browserSessionImpersonationSchema = browserSessionActorSchema
  .extend({ expires: z.coerce.date() })
  .strict();
export type BrowserSessionImpersonation = z.infer<typeof browserSessionImpersonationSchema>;
