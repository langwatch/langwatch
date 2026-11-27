import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { SecretsChain } from "../chain.ts";
import { secretLogRedactPaths } from "../redact.ts";
import { SecretsResolver } from "../resolver.ts";
import { Secret } from "../secret.ts";

const PREFIX = "ROUTE__";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secret-family-"));
const dotenv = path.join(dir, ".env");
fs.writeFileSync(dotenv, 'ROUTE__c="from-file"\nROUTE__a=file-loses\n# ROUTE__d=commented\n');
const emptyDotenv = path.join(dir, "empty.env");
fs.writeFileSync(emptyDotenv, 'ROUTE__quoted=""\nROUTE__bare=\nROUTE__a=file-loses\n');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const routes = Secret.family(PREFIX);

function resolverOver(
  environment: Readonly<Record<string, string | undefined>>,
  file: string = dotenv,
) {
  return SecretsResolver.over(SecretsChain.start({ environment }).withEnv().withFile(file));
}

describe("a secret family", () => {
  describe("when names under its prefix are set in the environment and the file", () => {
    /** @scenario "A family answers every set name under its prefix from the environment and the file" */
    it("answers each name under the prefix once, the environment winning a repeat", async () => {
      const scoped = resolverOver({
        ROUTE__a: "env-wins",
        ROUTE__b: "from-env",
        OTHER: "outside",
      }).scopeTo("stores", [routes]);

      const answered = await scoped.into(routes, (family) => Object.fromEntries(family));

      expect(answered).toEqual({
        ROUTE__a: "env-wins",
        ROUTE__b: "from-env",
        ROUTE__c: "from-file",
      });
    });
  });

  describe("when a name under its prefix is set to an empty value", () => {
    /** @scenario "A family keeps a name set to an empty value so its owner can refuse it" */
    it("answers that name with an empty value from the environment or the file", async () => {
      const scoped = resolverOver({ ROUTE__a: "" }, emptyDotenv).scopeTo("stores", [routes]);

      const answered = await scoped.into(routes, (family) => Object.fromEntries(family));

      expect(answered).toEqual({ ROUTE__a: "", ROUTE__quoted: "", ROUTE__bare: "" });
    });

    /** @scenario "A family keeps a name set to an empty value so its owner can refuse it" */
    it("still reads a single secret set to an empty value as unset", async () => {
      const single = Secret.load("ROUTE__a", { optional: true });
      const scoped = resolverOver({ ROUTE__a: "" }, emptyDotenv).scopeTo("stores", [single]);
      const unset = Secret.load("SINGLE", { optional: true });
      const scopedUnset = resolverOver({ SINGLE: "" }, emptyDotenv).scopeTo("stores", [unset]);

      await expect(scoped.into(single, (value) => value)).resolves.toBe("file-loses");
      await expect(scopedUnset.into(unset, (value) => value)).resolves.toBeUndefined();
    });
  });

  describe("when no name under its prefix is set", () => {
    /** @scenario "A family nobody sets resolves empty and never fails the preflight" */
    it("passes the preflight and resolves to no names", async () => {
      const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }).withEnv());

      await expect(resolver.preflight([routes])).resolves.toBeUndefined();
      await expect(
        resolver.scopeTo("stores", [routes]).into(routes, (family) => family.size),
      ).resolves.toBe(0);
    });
  });

  describe("when an owner declared a single secret spelled like the prefix", () => {
    /** @scenario "An owner that did not declare the family cannot resolve it" */
    it("refuses the family as undeclared", async () => {
      const scoped = resolverOver({ ROUTE__a: "x" }).scopeTo("rogue", [Secret.load(PREFIX)]);

      await expect(scoped.into(routes, (family) => family.size)).rejects.toMatchObject({
        code: "secret_undeclared",
      });
    });
  });

  it("adds no log redaction path of its own, since its values are never logged", () => {
    expect(secretLogRedactPaths([routes, Secret.load("SINGLE")])).toEqual(["SINGLE", "*.SINGLE"]);
  });
});
