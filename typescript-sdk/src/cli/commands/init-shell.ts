import { loadConfig, isLoggedIn } from "@/cli/utils/governance/config";
import { envForTool } from "@/cli/utils/governance/wrapper";

const TOOLS = ["claude", "codex", "cursor", "gemini"] as const;

/**
 * `langwatch init-shell <shell>` — print an eval-able snippet so
 * any shell session auto-exports the gateway env vars for every
 * wrapped tool (claude, codex, cursor, gemini). The always-on
 * alternative to the `langwatch claude` exec wrapper:
 *
 *   eval "$(langwatch init-shell zsh)"
 *
 * Supported shells: zsh, bash, fish, cmd, powershell. Defaults to
 * zsh.
 *
 * The bare `langwatch init` is reserved by the existing prompt-
 * project init flow; this is namespaced as `init-shell` to avoid
 * a regression on the existing CLI surface.
 */
export const initShellCommand = async (
  shell?: string,
): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stdout.write("# not logged in — run `langwatch login --device` first\n");
    process.exit(1);
  }

  // Union the env vars across all wrapped tools, dedup keys.
  const seen = new Set<string>();
  const entries: Array<[string, string]> = [];
  for (const tool of TOOLS) {
    for (const [k, v] of Object.entries(envForTool(cfg, tool).vars)) {
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push([k, v]);
    }
  }

  const target = (shell ?? "zsh").toLowerCase();
  switch (target) {
    case "fish":
      for (const [k, v] of entries) {
        process.stdout.write(`set -gx ${k} ${quoteFish(v)}\n`);
      }
      break;
    case "cmd":
      for (const [k, v] of entries) {
        process.stdout.write(`set ${k}=${v}\n`);
      }
      break;
    case "powershell":
    case "pwsh":
      for (const [k, v] of entries) {
        process.stdout.write(`$env:${k} = '${v.replace(/'/g, "''")}'\n`);
      }
      break;
    default: {
      // bash / zsh / sh
      for (const [k, v] of entries) {
        process.stdout.write(`export ${k}=${quotePosix(v)}\n`);
      }
    }
  }
};

function quotePosix(s: string): string {
  if (!/[ \t\n'"$\\]/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function quoteFish(s: string): string {
  if (!/[ \t\n'"$\\]/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
