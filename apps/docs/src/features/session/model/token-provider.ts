import { z } from "zod/mini";

const text = () => z.string().check(z.minLength(1));

export const docsSessionTokenSchema = z.strictObject({
  token: text(),
  grantId: text(),
  projectId: text(),
  projectName: text(),
  apiOrigin: z.url(),
  expiresAt: z.int().check(z.positive()),
  purpose: z.literal("docs-playground"),
  permissions: z.array(text()).check(z.minLength(1)),
});
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
