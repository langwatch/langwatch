/** docs.json redirects: source path (no trailing slash) to destination. */
export type RedirectRules = Readonly<Record<string, string>>;

function segments({ path }: { path: string }) {
  return path.split("/").filter(Boolean);
}

/** The destination for one pattern source, with `:name` and `:name*` filled in, or null. */
function matchPattern({
  source,
  destination,
  path,
}: {
  source: string;
  destination: string;
  path: string;
}) {
  const wanted = segments({ path: source });
  const actual = segments({ path });
  const values = new Map<string, string>();
  for (const [index, part] of wanted.entries()) {
    if (part.startsWith(":") && part.endsWith("*")) {
      values.set(part.slice(1, -1), actual.slice(index).join("/"));
      return fill({ destination, values });
    }
    const value = actual[index];
    if (value === undefined) return null;
    if (part.startsWith(":")) values.set(part.slice(1), value);
    else if (part !== value) return null;
  }
  return wanted.length === actual.length ? fill({ destination, values }) : null;
}

function fill({ destination, values }: { destination: string; values: Map<string, string> }) {
  return destination.replace(/:(\w+)\*?/g, (whole, name: string) => values.get(name) ?? whole);
}

/** An exact source wins; otherwise the first `:param` or `:param*` source that matches. */
export function matchRedirect({ path, redirects }: { path: string; redirects: RedirectRules }) {
  const exact = redirects[path.replace(/\/$/, "")];
  if (exact) return exact;
  for (const [source, destination] of Object.entries(redirects)) {
    if (!source.includes(":")) continue;
    const match = matchPattern({ source, destination, path });
    if (match !== null) return match.replace(/\/+$/, "") || "/";
  }
  return null;
}
