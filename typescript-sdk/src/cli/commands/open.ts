import chalk from "chalk";
import open from "open";

import { isLoggedIn, loadConfig } from "@/cli/utils/governance/config";

/**
 * `langwatch open [path]` — open the LangWatch app in the user's
 * default browser.
 *
 * No path:
 *   - Project mode (LANGWATCH_API_KEY set in the shell or .env): open
 *     the control-plane root and let the app route to the matching
 *     project home based on the session.
 *   - Personal mode: open `/me`, the personal AI tools portal.
 *
 * With path: open `${control_plane_url}/${path}` verbatim. Lets
 * `langwatch open traces`, `langwatch open governance`, etc. work
 * without a dedicated subcommand per surface.
 */
export const openCommand = async (
  options: { path?: string; browser?: string } = {},
): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    console.error(
      chalk.yellow("Not logged in. Run `langwatch login` first."),
    );
    process.exit(1);
  }

  const base = cfg.control_plane_url.replace(/\/+$/, "");
  let target: string;
  if (options.path) {
    const trimmed = options.path.replace(/^\/+/, "");
    target = `${base}/${trimmed}`;
  } else if (process.env.LANGWATCH_API_KEY) {
    target = base;
  } else {
    target = `${base}/me`;
  }

  console.log(`Opening ${target}`);
  await openInBrowser(target, options.browser);
};

async function openInBrowser(url: string, override?: string): Promise<void> {
  const choice =
    override ?? process.env.LANGWATCH_BROWSER ?? process.env.BROWSER ?? "";
  if (choice === "none") return;
  try {
    if (!choice || choice === "default") {
      await open(url);
      return;
    }
    await open(url, { app: { name: choice } });
  } catch {
    // URL already on stdout; don't fail because the browser couldn't open.
  }
}
