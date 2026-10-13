import { existsSync, readFileSync } from "node:fs";

/**
 * Minimal `.env` parser. Handles `KEY=value` lines, blank lines, and
 * `# comments`. Quotes around values are stripped if balanced. We avoid
 * pulling in `dotenv` to keep the CLI bundle small.
 */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (isQuoted) {
      value = value.slice(1, -1);
    }
    // A `KEY=` line means "not configured" — passing it through as "" is
    // worse: `?? fallback` treats empty as present, and a scaffolded
    // blank OPENAI_API_KEY etc. then crashes construction at boot.
    if (value === "") continue;
    out[key] = value;
  }
  return out;
}
