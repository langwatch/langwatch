import chalk from "chalk";
import { loadConfig, isLoggedIn } from "@/cli/utils/governance/config";

/**
 * `langwatch dashboard` — opens the user's /me page in their browser.
 *
 * `--trace <id>` deep-links into the per-trace view directly (the
 * Screen-5 → Screen-6 bridge from gateway.md: developers spend
 * most of their time in the terminal, but jumping to a specific
 * trace's view in the dashboard shouldn't require copy/pasting
 * IDs).
 *
 * If the trace ID doesn't exist (revoked, expired, wrong workspace)
 * the dashboard renders its own 404 — the CLI's job ends at
 * opening the URL.
 */
export const dashboardCommand = async (
  options?: { trace?: string; browser?: string },
): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    console.error(chalk.yellow("Not logged in. Run `langwatch login --device` first."));
    process.exit(1);
  }

  let target = `${cfg.control_plane_url.replace(/\/+$/, "")}/me`;
  if (options?.trace) {
    target += `/traces/${encodeURIComponent(options.trace)}`;
  }

  console.log(`Opening ${target}`);
  await openInBrowser(target, options?.browser);
};

async function openInBrowser(url: string, override?: string): Promise<void> {
  const choice = override ?? process.env.LANGWATCH_BROWSER ?? process.env.BROWSER ?? "";
  if (choice === "none") return;
  const open = (await import("open")).default;
  try {
    if (!choice || choice === "default") {
      await open(url);
      return;
    }
    await open(url, { app: { name: choice } });
  } catch {
    // Don't fail the command because the browser couldn't open —
    // the URL is already on stdout.
  }
}
