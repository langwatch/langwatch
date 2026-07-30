/**
 * Rendering a claim URL as a QR code the developer can scan with their phone.
 *
 * The phone is where the passkey ceremony has to happen — a terminal cannot be
 * a trustworthy WebAuthn client — so getting the URL onto a phone is the whole
 * job, and a QR is the shortest path from "it is on my screen" to "it is on my
 * phone".
 *
 * The URL is always printed as text too. A QR is useless in a scrollback
 * buffer, in CI logs, over a flaky SSH connection, or to anyone using a screen
 * reader, and those are exactly the places this command runs.
 */

/** Smallest terminal width a QR renders legibly in, including quiet zone. */
const MIN_QR_WIDTH = 45;

export interface QrRenderContext {
  /** False for pipes, CI and agent-driven runs. */
  isInteractive: boolean;
  /** Terminal width, when it is known. */
  columns?: number;
  /** True when an agent is driving; it cannot scan anything. */
  isAgent: boolean;
}

/**
 * Whether a QR is worth drawing. A mangled QR is worse than none — it looks
 * scannable, so the developer tries, fails, and blames their camera.
 */
export function shouldRenderQr(ctx: QrRenderContext): boolean {
  if (ctx.isAgent) return false;
  if (!ctx.isInteractive) return false;
  if (ctx.columns !== undefined && ctx.columns < MIN_QR_WIDTH) return false;
  return true;
}

/**
 * The QR as terminal text, or null when it could not be produced.
 *
 * Never throws: a failure here must not take down a provisioning run that has
 * already created an account, because the URL beside it works perfectly well
 * on its own. Imported lazily to keep the encoder off the CLI's boot graph.
 */
export async function renderQr(url: string): Promise<string | null> {
  try {
    const { toString } = await import("qrcode");
    return await toString(url, {
      type: "terminal",
      small: true,
      errorCorrectionLevel: "L",
    });
  } catch {
    return null;
  }
}

/**
 * The claim block as the developer sees it: the QR when it helps, and the URL
 * always. Returns lines rather than printing, so the caller owns the stream
 * and tests can assert on the text.
 */
export async function renderClaimBlock(params: {
  url: string;
  context: QrRenderContext;
}): Promise<string[]> {
  const lines: string[] = [];

  if (shouldRenderQr(params.context)) {
    const qr = await renderQr(params.url);
    if (qr) {
      lines.push("Scan to keep this account:");
      lines.push(qr.replace(/\n+$/, ""));
    }
  }

  lines.push(params.url);
  return lines;
}
