/**
 * Langy's prompt names the trace origins it may pass to `--origin`, and that
 * list has to match the ones the platform actually stamps.
 *
 * A wrong name here does not fail: `parseOriginOption` forwards the string
 * unvalidated ("origins are free-form strings on the platform"), so an origin
 * Langy has never heard of returns zero rows and reads like a correct empty
 * answer. Every "what has my agent been up to?" question rides on this list,
 * which is why it is pinned to the product rather than maintained by hand.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { ORIGIN_DISPLAY } from "@langwatch/trace-web";

const here = path.dirname(fileURLToPath(import.meta.url));
const promptPath = path.resolve(
  here,
  "../../../../../../services/langyagent/internal/assets/AGENTS.md",
);

/**
 * `langy` is stamped by the relay and has its own precedence rule in
 * `trace-origin.service.ts`, but has no row in `ORIGIN_DISPLAY` yet, so it
 * renders in the Trace Explorer as a raw lowercase label with a hash-rotated
 * colour. Adding that row is a Trace Explorer change with a palette decision
 * attached; until then it is named here so this check still covers it.
 */
const STAMPED_ONLY_ORIGINS = ["langy"];

const expectedOrigins = [...Object.keys(ORIGIN_DISPLAY), ...STAMPED_ONLY_ORIGINS];

function originsNamedInPrompt(prompt: string): string[] {
  const line = prompt.split("\n").find((l) => l.startsWith("**Trace origins:**"));
  if (!line) throw new Error("the prompt no longer has a Trace origins line");
  // Only the sentence that enumerates them; later sentences cite single
  // origins as examples and would otherwise count as part of the list.
  const enumeration = line.slice(0, line.indexOf("."));
  return [...enumeration.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!);
}

describe("given Langy's prompt lists the trace origins", () => {
  const prompt = fs.readFileSync(promptPath, "utf8");

  describe("when the list is compared with the origins the platform stamps", () => {
    /** @scenario The prompt names every trace origin the platform stamps */
    it("names every one of them, and invents none", () => {
      expect(originsNamedInPrompt(prompt).sort()).toEqual([...expectedOrigins].sort());
    });
  });
});
