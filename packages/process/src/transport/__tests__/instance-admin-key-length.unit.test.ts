/**
 * @see specs/server/feature-configuration.feature
 */
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { apiOwner } from "../config-owner.ts";

const resolveKey = (environment: Record<string, string | undefined>) =>
  SecretsResolver.over(SecretsChain.start({ environment }).withEnv())
    .scopeTo(apiOwner.name, Object.values(apiOwner.secrets))
    .into(apiOwner.secrets.instanceAdmin, (token) => token);

describe("the instance administrator key", () => {
  describe("given a key shorter than 32 characters", () => {
    /** @scenario "An instance administrator key shorter than 32 characters refuses the boot" */
    it("refuses with the configuration refusal", async () => {
      await expect(
        resolveKey({ LANGWATCH_INSTANCE_ADMIN_API_KEY: "short-key" }),
      ).rejects.toMatchObject({ code: "config_refused" });
    });
  });

  describe("given a key of 32 characters or more", () => {
    it("is the door's token", async () => {
      const key = "k".repeat(32);
      await expect(resolveKey({ LANGWATCH_INSTANCE_ADMIN_API_KEY: key })).resolves.toBe(key);
    });
  });

  describe("given the key is blank or unset", () => {
    /** @scenario "An instance administrator key shorter than 32 characters refuses the boot" */
    it("reads as absent rather than refusing", async () => {
      await expect(resolveKey({ LANGWATCH_INSTANCE_ADMIN_API_KEY: "" })).resolves.toBeUndefined();
      await expect(resolveKey({})).resolves.toBeUndefined();
    });
  });
});
