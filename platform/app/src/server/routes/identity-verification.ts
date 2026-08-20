/**
 * The email verification ceremony's magic-link LANDING page (D01):
 * GET renders, and only ever renders.
 *
 *   GET /api/identity/verify   touches NO state: a mail scanner or preview
 *                              prefetch that follows the link consumes
 *                              nothing and verifies nothing.
 *
 * Completion is the identity family's RPC operation
 * `POST /api/identity/verification.complete`
 * (src/app/api/identity/[[...route]]/app.ts), which requires the signed-in
 * user, the emailed token AND the PKCE code_verifier the initiating context
 * kept — checked by the ceremony service against the id-pinned record.
 *
 * Spec: specs/identity/identifier-model.feature (verification scenarios).
 */
import type { Context } from "hono";
import { createServiceApp, publicEndpoint } from "~/server/api/security";

const secured = createServiceApp({
  basePath: "/api/identity",
  errorEnvelope: "canonical",
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Render-only, deliberately public: the link lands from a mailbox, possibly
// on a device with no session. Completion carries the real proofs, so this
// page holding the token grants nothing by itself.
secured
  .access(
    publicEndpoint(
      "magic-link landing page; renders only, verification requires the verification.complete RPC with session + PKCE verifier",
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

export const app = secured.hono;
