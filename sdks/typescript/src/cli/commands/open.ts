import chalk from "chalk";
import open from "open";

import { isLoggedIn, loadConfig } from "@/cli/utils/governance/config";
import { normalizeEndpoint } from "@/internal/endpoint";

/**
 * Open the app: /me, or the project home with LANGWATCH_API_KEY; with a path, BASE/path.
 */
export const openCommand = async (
  options: { path?: string; browser?: string } = {},
): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    console.error(chalk.yellow("Not logged in. Run `langwatch login` first."));
    process.exit(1);
  }

  const base = normalizeEndpoint(cfg.control_plane_url);
  let target: string;
  if (options.path) {
    const trimmed = options.path.replace(/^\/+/, "");
    target = `${base}/${trimmed}`;
  } else if (process.env.LANGWATCH_API_KEY) {
    target = base;
  } else {
    // /me is kept so the link works on servers with and without the /coding-agents route,
    // which redirect /me.
    target = `${base}/me`;
  }

  console.log(`Opening ${target}`);
  await openInBrowser(target, options.browser);
};

async function openInBrowser(url: string, override?: string): Promise<void> {
  const choice = override ?? process.env.LANGWATCH_BROWSER ?? process.env.BROWSER ?? "";
  if (choice === "none") return;
  try {
    if (!choice || choice === "default") {
      await open(url);
      return;
    }
    await open(url, { app: { name: choice } });
  } catch {
    // URL already on stdout; don't fail because the browser couldn't open.
    void 0;
  }
}
