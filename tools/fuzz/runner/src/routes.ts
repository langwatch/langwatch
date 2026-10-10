import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** ROUTE_TABLE is where the UI declares its URL surface: every registered path, as data. */
const ROUTE_TABLE = fileURLToPath(
  new URL("../../../../apps/ui/src/shell/ui-route-table.ts", import.meta.url),
);

/**
 * extractRoutes reads the paths of the table's page routes. A redirect carries `redirect: {`
 * after its path, so the brace stops the match; only a path with a `page:` key counts.
 */
export const extractRoutes = (source: string): string[] => {
  const found = new Set<string>();
  for (const match of source.matchAll(/path:\s*"([^"]+)"[^{}]*?page:/g)) {
    found.add(match[1] as string);
  }
  return [...found];
};

export const registeredRoutes = (): string[] => extractRoutes(readFileSync(ROUTE_TABLE, "utf8"));

export interface Expanded {
  route: string;
  path?: string;
  skipped?: string;
}

/**
 * expandRoute fills a pattern's parameters: `:project` is the fuzzer's slug, any other
 * `:name` comes from fixtures, and a wildcard or an unfilled name is skipped with its reason.
 */
export const expandRoute = ({
  route,
  slug,
  fixtures = {},
}: {
  route: string;
  slug: string;
  fixtures?: Readonly<Record<string, string>>;
}): Expanded => {
  const segments: string[] = [];
  for (const segment of route.split("/")) {
    if (segment === "*") return { route, skipped: "wildcard" };
    if (!segment.startsWith(":")) {
      segments.push(segment);
      continue;
    }
    const name = segment.slice(1).replace(/\?$/, "");
    const value = name === "project" ? slug : fixtures[name];
    if (value !== undefined) segments.push(encodeURIComponent(value));
    else if (!segment.endsWith("?")) return { route, skipped: `no fixture for :${name}` };
  }
  return { route, path: segments.join("/") || "/" };
};
