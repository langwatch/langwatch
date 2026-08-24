import { execa } from "execa";
import chalk from "chalk";
import { isMac } from "../shared/platform.ts";

/**
 * Best-effort browser open. On macOS we use `open`, on Linux we try
 * `xdg-open`. Failing that we just print the URL — it's a UX nicety, not
 * a hard dependency.
 */
export async function openBrowser(url: string): Promise<void> {
  console.log("");
  console.log(chalk.bold.green(`✓ langwatch is running at ${chalk.underline(url)}`));
  if (process.env.LANGWATCH_NO_OPEN === "1") return;
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
