/**
 * The email verification ceremony's route shape (D01): GET renders, POST
 * completes — and only POST can verify anything.
 *
 *   GET  /api/identity/verify   the magic-link landing. Renders a page and
 *                               touches NO state: a mail scanner or preview
 *                               prefetch that follows the link consumes
 *                               nothing and verifies nothing.
 *   POST /api/identity/verify   the completion. Requires the signed-in user,
 *                               the emailed token AND the PKCE code_verifier
 *                               the initiating context kept — checked by the
 *                               ceremony service against the pinned record.
 *
 * Spec: specs/identity/identifier-model.feature (verification scenarios).
 */
import type { Context } from "hono";
import { z } from "zod";
import {
  createServiceApp,
  handlerManagedAuth,
  publicEndpoint,
} from "~/server/api/security";
import { IdentityCeremonies } from "~/server/app-layer/identity/identity-ceremonies";
import {
  PrismaIdentityVerificationRepository,
  PrismaVerifiableIdentifierReads,
} from "~/server/app-layer/identity/repositories/identity-verification.prisma.repository";
import { VerificationCeremonyService } from "~/server/app-layer/identity/verification-ceremony";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";

const secured = createServiceApp({
  basePath: "/api/identity",
  errorEnvelope: "canonical",
});

/** Composed lazily so importing the route never composes the app graph. */
let service: VerificationCeremonyService | null = null;
function verificationCeremonies(): VerificationCeremonyService {
  service ??= new VerificationCeremonyService({
    store: new PrismaIdentityVerificationRepository(prisma),
    identifiers: new PrismaVerifiableIdentifierReads(prisma),
    ceremonies: new IdentityCeremonies({ prisma }),
  });
  return service;
}

/** Test seam: swap the composed service without touching module state. */
export function setVerificationCeremoniesForTests(
  replacement: VerificationCeremonyService | null,
): void {
  service = replacement;
}

const completionBodySchema = z.object({
  identifierId: z.string().min(1),
  verificationId: z.string().min(1),
  token: z.string().min(1),
  codeVerifier: z.string().min(1),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- GET /api/identity/verify ----------
// Render-only, deliberately public: the link lands from a mailbox, possibly
// on a device with no session. Completion is the POST and carries the real
// proofs, so this page holding the token grants nothing by itself.
secured
  .access(
    publicEndpoint(
      "magic-link landing page; renders only, verification requires the POST with session + PKCE verifier",
    ),
  )
  .get("/verify", (c: Context) => {
    const verificationId = c.req.query("vid") ?? "";
    const token = c.req.query("token") ?? "";
    // The initiating context (which holds the code_verifier) reads these off
    // the page to complete; this response itself changes nothing.
    return c.html(
      `<!doctype html>
<html lang="en">
  <head><meta name="robots" content="noindex" /><title>Confirm your email</title></head>
  <body data-verification-id="${escapeHtml(verificationId)}" data-token="${escapeHtml(token)}">
    <main>
      <h1>Almost there</h1>
      <p>Return to the window where you requested this verification to finish confirming your email address.</p>
      <p>Opening this link on its own does not confirm anything.</p>
    </main>
  </body>
</html>`,
    );
  });

// ---------- POST /api/identity/verify ----------
secured
  .access(
    handlerManagedAuth({
      reason:
        "user session validated in-handler via getServerAuthSession; the ceremony service checks token, PKCE verifier and record pinning",
      permissions: [],
      credential: "session",
    }),
  )
  .post("/verify", async (c: Context) => {
    const session = await getServerAuthSession({ req: c.req.raw as never });
    if (!session?.user?.id) {
      return c.json(
        { error: "You must be logged in to complete a verification." },
        { status: 401 },
      );
    }
    const body = completionBodySchema.parse(await c.req.json());
    await verificationCeremonies().completeEmailVerification({
      userId: session.user.id,
      identifierId: body.identifierId,
      verificationId: body.verificationId,
      token: body.token,
      codeVerifier: body.codeVerifier,
    });
    return c.json({ verified: true });
  });

export const app = secured.hono;
