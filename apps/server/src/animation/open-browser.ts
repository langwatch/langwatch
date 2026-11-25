import chalk from "chalk";
import { execa } from "execa";

import { isMac } from "../shared/platform.ts";
import { homePath } from "./log-tee.ts";

/** What the CLI prints once the app is reachable: where it runs, where it logs, how to stop. */
export function runningLine({ url, logsDir }: { url: string; logsDir: string }): string {
  const running = chalk.bold.green(`✓ langwatch is running at ${chalk.underline(url)}`);
  const help = chalk.dim(`  logs in ${homePath(logsDir)} · Ctrl+C to stop`);
  return `\n${running}\n${help}\n`;
}

export type BrowserOpenOptions = {
  openEnabled: boolean;
};

/**
 * Best-effort browser open: `open` on macOS, `xdg-open` on Linux. Failing that, the running
 * line still names the URL; it is a nicety, not a hard dependency.
 */
export async function openBrowser(url: string, options: BrowserOpenOptions): Promise<void> {
  if (!options.openEnabled) return;
  try {
    if (isMac()) {
      await execa("open", [url], { reject: false });
    } else {
      await execa("xdg-open", [url], { reject: false });
    }
  } catch {
    // best effort
  }
}
