import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Each page's last commit date (ISO 8601) from one `git log` pass over the docs folder. A
 * shallow or missing history would date every page to one commit, so it yields no dates.
 */
export function pageLastModified({ docsRoot }: { docsRoot: string }): Map<string, string> {
  const dates = new Map<string, string>();
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: docsRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  try {
    if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false") return dates;
    const prefix = git(["rev-parse", "--show-prefix"]).trim();
    let date = "";
    for (const line of git(["log", "--format=%x00%cI", "--name-only", "--", "."]).split("\n")) {
      if (line.startsWith("\0")) date = line.slice(1);
      else if (line.endsWith(".mdx") && line.startsWith(prefix)) {
        const slug = path.posix.relative(prefix, line).replace(/\.mdx$/, "");
        if (!dates.has(slug)) dates.set(slug, date);
      }
    }
  } catch {
    dates.clear();
  }
  return dates;
}
