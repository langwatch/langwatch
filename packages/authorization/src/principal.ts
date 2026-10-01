import { z } from "zod";

/** Who authz checks a credential as: a person, or an API key's own row. */
export const principalRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), id: z.string() }).strict(),
  z.object({ type: z.literal("apiKey"), id: z.string() }).strict(),
]);
export type PrincipalRef = z.infer<typeof principalRefSchema>;
