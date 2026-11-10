import type { CodingTerminal } from "@langwatch/coding-agent-contract";

/** What `terminal.type` was seen to hold, lowercased; the JetBrains IDEs report by product. */
const TERMINAL_BY_REPORTED: ReadonlyMap<string, CodingTerminal> = new Map<string, CodingTerminal>([
  ["vscode", "vscode"],
  ["cursor", "cursor"],
  ["windsurf", "windsurf"],
  ["zed", "zed"],
  ["jetbrains-jediterm", "jetbrains"],
  ["intellij", "jetbrains"],
  ["pycharm", "jetbrains"],
  ["webstorm", "jetbrains"],
  ["phpstorm", "jetbrains"],
  ["rubymine", "jetbrains"],
  ["clion", "jetbrains"],
  ["goland", "jetbrains"],
  ["rider", "jetbrains"],
  ["datagrip", "jetbrains"],
  ["androidstudio", "jetbrains"],
  ["fleet", "jetbrains"],
  ["iterm.app", "iterm"],
  ["apple_terminal", "apple_terminal"],
  ["ghostty", "ghostty"],
  ["xterm-ghostty", "ghostty"],
  ["kitty", "kitty"],
  ["xterm-kitty", "kitty"],
  ["alacritty", "alacritty"],
  ["wezterm", "wezterm"],
  ["warpterminal", "warp"],
  ["tmux", "tmux"],
  ["windows-terminal", "windows_terminal"],
]);

/**
 * The closed name a client's `terminal.type` goes to peers under: the raw string flows to Postgres,
 * a Redis key and Customer.io otherwise. Undefined when the session reported none.
 */
export function classifyCodingTerminal(
  reported: string | undefined | null,
): CodingTerminal | undefined {
  const name = reported?.trim().toLowerCase();
  if (!name) return undefined;
  // `TERM` values such as `xterm-256color`, after the terminals that report through one.
  if (!TERMINAL_BY_REPORTED.has(name) && name.startsWith("xterm")) return "xterm";
  return TERMINAL_BY_REPORTED.get(name) ?? "other";
}
