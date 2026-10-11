import { z } from "zod";

export const docsSessionTokenSchema = z
  .object({
    token: z.string().min(1),
    grantId: z.string().min(1),
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    apiOrigin: z.url(),
    expiresAt: z.number().int().positive(),
    purpose: z.literal("docs-playground"),
    permissions: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type DocsSessionToken = z.infer<typeof docsSessionTokenSchema>;

export interface DocsTokenProvider {
  readonly kind: "mock" | "app";
  acquire(input: { signal: AbortSignal }): Promise<DocsSessionToken>;
  revoke(input: { grantId: string }): Promise<void>;
}

export class DocsSessionError extends Error {
  readonly code: "cancelled" | "expired" | "invalid" | "scope" | "unavailable";

  constructor({ code, message }: { code: DocsSessionError["code"]; message: string }) {
    super(message);
    this.name = "DocsSessionError";
    this.code = code;
  }
}
