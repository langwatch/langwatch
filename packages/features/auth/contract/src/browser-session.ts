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

export const verifiedBrowserSessionSchema = z
  .object({
    session: z.object({ id: z.string().min(1), expiresAt: z.coerce.date() }).strict(),
    user: browserSessionUserSchema,
  })
  .strict();
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
