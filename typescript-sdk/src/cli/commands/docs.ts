import chalk from "chalk";

const LANGWATCH_DOCS_BASE = "https://langwatch.ai/docs";
const LANGWATCH_DOCS_INDEX = "https://langwatch.ai/docs/llms.txt";

const SCENARIO_DOCS_BASE = "https://langwatch.ai/scenario";
const SCENARIO_DOCS_INDEX = "https://langwatch.ai/scenario/llms.txt";

type DocsKind = "langwatch" | "scenario";

export function normalizeDocsUrl(input: string | undefined, kind: DocsKind): string {
  const indexUrl = kind === "scenario" ? SCENARIO_DOCS_INDEX : LANGWATCH_DOCS_INDEX;
  const baseUrl = kind === "scenario" ? SCENARIO_DOCS_BASE : LANGWATCH_DOCS_BASE;

  let url = (input ?? "").trim();
  if (url === "") return indexUrl;

  // Strip wrapping quotes (agents sometimes paste quoted urls)
  url = url.replace(/^['"]|['"]$/g, "").trim();
  if (url === "") return indexUrl;

  // Append .md if not already an .md/.txt file
  const hasExt = /\.(md|txt)(\?|#|$)/i.test(url);
  if (!hasExt) {
    url = url.replace(/\/$/, "");
    url += ".md";
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  let path = url;
  if (kind === "langwatch") {
    // Strip a leading "docs/" to avoid duplicating the prefix
    path = path.replace(/^\/+/, "");
    if (path.startsWith("docs/")) {
      path = path.slice("docs/".length);
    }
  } else {
    path = path.replace(/^\/+/, "");
    if (path.startsWith("scenario/")) {
      path = path.slice("scenario/".length);
    }
  }

  return `${baseUrl}/${path}`;
}

async function fetchAndPrint(url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "text/markdown, text/plain;q=0.9, */*;q=0.5" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error fetching ${url}: ${message}`));
    process.exit(1);
  }

  if (!response.ok) {
    console.error(
      chalk.red(
        `Error fetching ${url}: HTTP ${response.status} ${response.statusText}`,
      ),
    );
    process.exit(1);
  }

  const body = await response.text();
  process.stdout.write(body);
  if (!body.endsWith("\n")) process.stdout.write("\n");
}

export async function docsCommand(url?: string): Promise<void> {
  const target = normalizeDocsUrl(url, "langwatch");
  await fetchAndPrint(target);
}

export async function scenarioDocsCommand(url?: string): Promise<void> {
  const target = normalizeDocsUrl(url, "scenario");
  await fetchAndPrint(target);
}
