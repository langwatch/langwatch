/**
 * The `ops call` line printed after an approval must run as printed: each suggested input is
 * checked against a function input built the way the staff-access contract builds it and
 * listed the way the server lists it (`z.toJSONSchema(input, { io: "input" })`).
 * @see modules/staff-access/specs/staff-access-cli.feature
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { sampleInput, suggestOpsCall } from "../ops/call-hint";

const isoTime = z.iso.datetime({ offset: true });
const pageInput = {
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).max(500).optional(),
};
const rangeInput = { since: isoTime, until: isoTime.optional() };

const inputs = {
  "org.snapshot": z.object({}).strict(),
  "org.ingestion_health": z.object({ ...rangeInput, ...pageInput }).strict(),
  "orgs.find": z.object({ query: z.string().trim().min(1).max(200), ...pageInput }).strict(),
  "user.sign_in": z.object({ email: z.email().max(320) }).strict(),
};
type Name = keyof typeof inputs;

const listing = (Object.keys(inputs) as Name[]).map((name) => ({
  name,
  inputSchema: z.toJSONSchema(inputs[name], { io: "input" }) as Record<string, unknown>,
}));

const now = new Date("2026-11-26T12:00:00.000Z");

/** The --input JSON out of a printed `langwatch ops call <name> --input '<json>'` line. */
const parseSuggestion = (line: string): { name: Name; input: unknown } => {
  const match = /^langwatch ops call (\S+) --input '(.*)'$/.exec(line);
  if (!match?.[1] || match[2] === undefined) throw new Error(`not a call line: ${line}`);
  return { name: match[1] as Name, input: JSON.parse(match[2]) as unknown };
};

describe("suggestOpsCall", () => {
  describe("when only a function with a required range is approved", () => {
    it("suggests a since its own input accepts", () => {
      const line = suggestOpsCall({ approved: ["org.ingestion_health"], listing, now });
      const { name, input } = parseSuggestion(line ?? "");
      expect(name).toBe("org.ingestion_health");
      expect(inputs[name].safeParse(input).success).toBe(true);
      expect(input).toEqual({ since: "2026-11-19T12:00:00.000Z" });
    });
  });

  describe("when a function needing no input is approved too", () => {
    it("prefers it", () => {
      const line = suggestOpsCall({
        approved: ["org.ingestion_health", "org.snapshot"],
        listing,
        now,
      });
      expect(line).toBe("langwatch ops call org.snapshot --input '{}'");
    });
  });

  describe("when every approved function needs a value only the caller knows", () => {
    it("suggests no call", () => {
      expect(suggestOpsCall({ approved: ["orgs.find", "user.sign_in"], listing, now })).toBe(
        undefined,
      );
    });
  });

  describe("when the approved function is not in the listing", () => {
    it("suggests no call", () => {
      expect(suggestOpsCall({ approved: ["org.gone"], listing, now })).toBe(undefined);
    });
  });

  it.each(Object.keys(inputs) as Name[])(
    "every suggestion for %s validates against its input",
    (approvedName) => {
      const line = suggestOpsCall({ approved: [approvedName], listing, now });
      if (line === undefined) return;
      const { name, input } = parseSuggestion(line);
      expect(inputs[name].safeParse(input).success).toBe(true);
    },
  );
});

describe("sampleInput", () => {
  it("fills nothing an optional property asks for", () => {
    const entry = listing.find((fn) => fn.name === "org.ingestion_health");
    expect(sampleInput({ inputSchema: entry?.inputSchema ?? {}, now })).toEqual({
      since: "2026-11-19T12:00:00.000Z",
    });
  });
});
