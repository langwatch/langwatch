import chalk from "chalk";

// The same ASCII art the langwatch app prints when it boots — see
// platform/app/src/start.ts. Keeping these in lockstep means `npx @langwatch/server`
// shows the same identity as `pnpm dev`.
const ASCII_ART = [
  "",
  "██╗      █████╗ ███╗   ██╗ ██████╗ ██╗    ██╗ █████╗ ████████╗ ██████╗██╗  ██╗",
  "██║     ██╔══██╗████╗  ██║██╔════╝ ██║    ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║",
  "██║     ███████║██╔██╗ ██║██║  ███╗██║ █╗ ██║███████║   ██║   ██║     ███████║",
  "██║     ██╔══██║██║╚██╗██║██║   ██║██║███╗██║██╔══██║   ██║   ██║     ██╔══██║",
  "███████╗██║  ██║██║ ╚████║╚██████╔╝╚███╔███╔╝██║  ██║   ██║   ╚██████╗██║  ██║",
  "╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝",
];

export function printBanner(version: string): void {
  console.log("");
  for (const line of ASCII_ART) console.log(chalk.bold.cyan(line));
  console.log(
    chalk.dim(
      `v${version} — gateway, observability, evaluations and agent simulations for your LLM stack.`,
    ),
  );
  console.log("");
}
