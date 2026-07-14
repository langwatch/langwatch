import chalk from "chalk";
import { loadConfig, isLoggedIn } from "@/cli/utils/governance/config";

/**
 * `langwatch request-increase` — Screen-8 tail of the budget-exceeded
 * flow. When the gateway 402's a request, it returns a signed
 * request_increase_url with the user/limit/spent params HMAC'd in.
 * The wrapper persists that URL on the way through; this command
 * opens the exact URL so the admin sees the request with the right
 * context.
 *
 * If no signed URL has been cached, fall back to the dashboard's
 * static request page.
 */
export const requestIncreaseCommand = async (
  options?: { browser?: string },
): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    console.error(chalk.yellow("Not logged in. Run `langwatch login --device` first."));
    process.exit(1);
  }

  const target =
    cfg.last_request_increase_url ??
    `${cfg.control_plane_url.replace(/\/+$/, "")}/me/budget/request`;

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
    /* see dashboard.ts */
  }
};
