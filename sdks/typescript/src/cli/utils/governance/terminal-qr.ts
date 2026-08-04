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

/** LangWatch amber. The only colour this block spends on decoration. */
const ACCENT = "#ED8926";

/**
 * Light modules around the code, in modules. Four is what the QR spec asks
 * for, and it is the difference between a camera locking on immediately and
 * the developer waving their phone around wondering whether it is working —
 * the scanner needs the border to find the symbol at all.
 */
const QUIET_ZONE = 4;

/** Left margin for the whole block, so it sits apart from surrounding output. */
const INDENT = "  ";

/**
 * Smallest terminal width a QR renders legibly in, including quiet zone.
 * A version-4 symbol is 33 modules; the zone adds 8, and the indent 2.
 */
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

interface Modules {
  size: number;
  data: ArrayLike<number>;
}

/** True when the module at (row, col) is dark; outside the symbol is light. */
function isDark(modules: Modules, row: number, col: number): boolean {
  if (row < 0 || col < 0 || row >= modules.size || col >= modules.size) {
    return false;
  }
  return modules.data[row * modules.size + col] === 1;
}

/**
 * One character per two module rows, using half-blocks: a terminal cell is
 * about twice as tall as it is wide, so pairing rows is what keeps the symbol
 * square instead of stretching it into an unscannable rectangle.
 *
 * Drawn dark-on-light rather than inverted. Cheap scanners assume dark modules
 * on a light field, and a light-on-dark code is the kind of thing that works
 * on the developer's phone and on nobody else's.
 */
function drawMatrix(
  modules: Modules,
  paint: (row: string) => string,
): string[] {
  const from = -QUIET_ZONE;
  const to = modules.size + QUIET_ZONE;
  const lines: string[] = [];

  // Two module rows per line; `top` is the upper half of each character cell.
  for (let top = from; top < to; top += 2) {
    let row = "";
    for (let col = from; col < to; col++) {
      const upper = isDark(modules, top, col);
      const lower = isDark(modules, top + 1, col);
      if (upper && lower) row += "█";
      else if (upper) row += "▀";
      else if (lower) row += "▄";
      else row += " ";
    }
    lines.push(paint(row));
  }
  return lines;
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
    const [{ create }, { default: chalk }] = await Promise.all([
      import("qrcode"),
      import("chalk"),
    ]);
    const { modules } = create(url, { errorCorrectionLevel: "L" });
    // bgHex/hex rather than the 16-colour codes: those resolve against the
    // terminal's own palette, and a "white" the user has themed to beige is a
    // contrast problem the scanner pays for.
    const paint = (row: string) => chalk.bgHex("#FFFFFF").hex("#000000")(row);
    return drawMatrix(modules as Modules, paint).join("\n");
  } catch {
    return null;
  }
}

/**
 * The claim block as the developer sees it: the QR when it helps, and the URL
 * always. Returns lines rather than printing, so the caller owns the stream
 * and tests can assert on the text.
 *
 * Where a QR would not help the block collapses to the bare URL. An agent, a
 * pipe and a CI log want the link and nothing else; prose there is noise that
 * something downstream has to parse around.
 */
export async function renderClaimBlock(params: {
  url: string;
  context: QrRenderContext;
}): Promise<string[]> {
  if (!shouldRenderQr(params.context)) return [params.url];

  const qr = await renderQr(params.url);
  if (!qr) return [params.url];

  const { default: chalk } = await import("chalk");
  const accent = chalk.hex(ACCENT);

  return [
    `${INDENT}${accent("▌")} ${chalk.bold("Keep this workspace")}`,
    `${INDENT}  ${chalk.dim("Scan with your phone. Either way you keep everything already collected.")}`,
    "",
    ...qr.split("\n").map((line) => `${INDENT}${line}`),
    "",
    `${INDENT}  ${accent("Sign in")} ${chalk.dim("with an account you already have")}`,
    `${INDENT}  ${accent("Create a passkey")} ${chalk.dim("— Face ID or a fingerprint, no password, no email")}`,
    "",
    `${INDENT}  ${chalk.dim(params.url)}`,
  ];
}
