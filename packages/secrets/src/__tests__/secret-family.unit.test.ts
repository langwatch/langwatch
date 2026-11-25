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
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const routes = Secret.family(PREFIX);

function resolverOver(environment: Readonly<Record<string, string | undefined>>) {
  return SecretsResolver.over(SecretsChain.start({ environment }).withEnv().withFile(dotenv));
}

describe("a secret family", () => {
  describe("when names under its prefix are set in the environment and the file", () => {
    /** @scenario "A family answers every set name under its prefix from the environment and the file" */
    it("answers each name under the prefix once, the environment winning a repeat", async () => {
      const scoped = resolverOver({
        ROUTE__a: "env-wins",
        ROUTE__b: "from-env",
        ROUTE__empty: "",
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
