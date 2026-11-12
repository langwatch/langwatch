import { execFileSync } from "node:child_process";
import path from "node:path";

/** Each page's first and last commit dates (ISO 8601), by slug. */
export type PageCommitDates = { published: Map<string, string>; modified: Map<string, string> };

/**
 * Each page's first and last commit dates from one `git log` pass over the docs folder (newest
 * first, so a page's first sighting is its last change). A shallow or missing history would date
 * every page to one commit, so it yields no dates. A moved page is first published at its move.
 */
export function pageCommitDates({ docsRoot }: { docsRoot: string }): PageCommitDates {
  const dates: PageCommitDates = { published: new Map(), modified: new Map() };
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
        if (!dates.modified.has(slug)) dates.modified.set(slug, date);
        dates.published.set(slug, date);
      }
    }
  } catch {
    dates.published.clear();
    dates.modified.clear();
  }
  return dates;
}

/** Each page's last commit date (ISO 8601); see `pageCommitDates`. */
export function pageLastModified({ docsRoot }: { docsRoot: string }): Map<string, string> {
  return pageCommitDates({ docsRoot }).modified;
}
