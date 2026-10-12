import { existsSync, readFileSync } from "node:fs";

import { note, type PlanSide } from "./protocol.ts";

const POLL_MILLIS = 500;

/** fixturesOf is the seeded ids a pending file names. */
const fixturesOf = (parsed: object): Record<string, string> => {
  const fixtures: Record<string, string> = {};
  const given = "fixtures" in parsed ? parsed.fixtures : undefined;
  if (typeof given === "object" && given !== null) {
    for (const [name, value] of Object.entries(given)) {
      if (typeof value === "string") fixtures[name] = value;
    }
  }
  return fixtures;
};

/** staticDirOf is the built UI a pending file names, if any. */
const staticDirOf = (parsed: object): string | undefined =>
  "staticDir" in parsed && typeof parsed.staticDir === "string" && parsed.staticDir !== ""
    ? parsed.staticDir
    : undefined;

/**
 * readPendingSide reads the file Go writes once a staggered side's stack is up
 * (PendingBaseFile in stagger.go): the side with its address and fixtures, or
 * the reason its stack never came up.
 */
export const readPendingSide = ({
  definition,
  text,
}: {
  definition: PlanSide;
  text: string;
}): PlanSide => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${definition.name}: its pending file holds no side`);
  }
  if ("error" in parsed && typeof parsed.error === "string" && parsed.error !== "") {
    throw new Error(`${definition.name} never came up: ${parsed.error}`);
  }
  const baseUrl = "baseUrl" in parsed && typeof parsed.baseUrl === "string" ? parsed.baseUrl : "";
  if (baseUrl === "") throw new Error(`${definition.name}: its pending file names no address`);
  const fixtures = fixturesOf(parsed);
  const staticDir = staticDirOf(parsed);
  return {
    name: definition.name,
    baseUrl,
    fixtures,
    ...(staticDir === undefined ? {} : { staticDir }),
  };
};

/** awaitSide waits for a staggered side's stack; any other side is ready now. */
export const awaitSide = async (definition: PlanSide): Promise<PlanSide> => {
  const file = definition.pending;
  if (file === undefined) return definition;
  note({ text: `${definition.name}: waiting for its stack to come up`, err: process.stderr });
  while (!existsSync(file)) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MILLIS));
  }
  return readPendingSide({ definition, text: readFileSync(file, "utf8") });
};
