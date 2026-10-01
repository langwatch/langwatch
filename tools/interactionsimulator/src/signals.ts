import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

const run = promisify(execFile);

const logLineSchema = z.record(z.string(), z.unknown());

/** stackOf is the haven stack a routed URL names: app.<slug>.langwatch.localhost. */
export const stackOf = (url: string): string => new URL(url).hostname.split(".")[1] ?? "";

/** signature normalises a log line as .claude/tmp/logwatch does, so ids and numbers collapse. */
export const signature = (line: Record<string, unknown>): string => {
  let message = typeof line.msg === "string" ? line.msg : "";
  for (const key of ["err", "error", "message"]) {
    const value = line[key];
    if (typeof value === "string") message += ` ${value}`;
  }
  message = message
    .replace(/[0-9a-f]{8,}|[A-Za-z0-9_-]{21,}/g, "<id>")
    .replace(/\d+(\.\d+)?/g, "N");
  const lane = typeof line.lane === "string" ? line.lane : "?";
  const level = typeof line.level === "string" ? line.level : "?";
  return `${lane} ${level} ${message.slice(0, 160)}`;
};

/**
 * logSignatures are the stack's warn-and-worse log shapes since a step began.
 * The stack is shared, so a line may be another tool's; it is evidence, not a verdict.
 */
export const logSignatures = async ({
  stack,
  since,
}: {
  stack: string;
  since: number;
}): Promise<string[]> => {
  const seconds = Math.max(1, Math.ceil((Date.now() - since) / 1000));
  const output = await run(
    "haven",
    ["logs", "--stack", stack, "--level", "warn", "--since", `${seconds}s`, "--json"],
    { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
  ).then(
    (result) => result.stdout,
    () => "",
  );
  const found = new Set<string>();
  for (const text of output.split("\n")) {
    try {
      const parsed = logLineSchema.safeParse(JSON.parse(text));
      if (parsed.success) found.add(signature(parsed.data));
    } catch {
      // A line haven prints around the JSON is not a log line.
    }
  }
  return [...found];
};
