import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Config, parseProcessConfig } from "@langwatch/config";
import {
  defineBrowserConfig,
  parsePublicAppConfigMetaContent,
  parsePublicConfigSlice,
  processWebConfigSchema,
} from "@langwatch/config/public-app-config";
import { Secret } from "@langwatch/secrets";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { processOwner } from "../../owner.ts";
import { projectPublicConfig, resolveUiBundle } from "../bundle-config.ts";

const mailConfig = Config.define((c) => ({
  provider: c.env("EMAIL_PROVIDER", z.string().optional()),
}));
const mailWebConfigSchema = z.strictObject({ email: z.boolean() });
/** The kernel hands a projection its slice as the one parse produced it, untyped. */
const mailSlice = z.object({ provider: z.string().optional() });
const mailBrowserConfig = defineBrowserConfig({
  schema: mailWebConfigSchema,
  project: (config: unknown) => ({ email: Boolean(mailSlice.parse(config).provider) }),
});

const parsedConfig = () =>
  parseProcessConfig({
    owners: [processOwner, { name: "mail", config: mailConfig }],
    environment: {
      BASE_HOST: "https://app.example.test",
      NODE_ENV: "production",
      IS_SAAS: "true",
      EMAIL_PROVIDER: "smtp",
    },
  });

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-config-"));
  fs.writeFileSync(path.join(directory, "index.html"), "<html><head></head><body></body></html>");
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function servedMetaContent(head: string): string {
  return /<meta name="langwatch-public-config" content="([^"]+)">/.exec(head)?.[1] ?? "";
}

describe("given the page the api serves", () => {
  describe("when installed modules declare browser projections", () => {
    it("carries a meta tag the browser's reader parses, namespaced by owner", () => {
      const publicConfig = projectPublicConfig({
        modules: [{ name: "mail", publicConfig: mailBrowserConfig.project }],
        config: parsedConfig(),
      });
      const bundle = resolveUiBundle({ directory, publicConfig });

      const served = parsePublicAppConfigMetaContent(servedMetaContent(bundle?.head ?? ""));

      expect(
        parsePublicConfigSlice({
          config: served,
          owner: "process",
          schema: processWebConfigSchema,
        }),
      ).toEqual({
        appBaseUrl: "https://app.example.test",
        mode: "production",
        deployment: "saas",
        nlp: false,
        browserTracing: false,
        sampleRatio: 1,
      });
      expect(
        parsePublicConfigSlice({ config: served, owner: "mail", schema: mailWebConfigSchema }),
      ).toEqual({ email: true });
    });
  });

  describe("when a projection answers a key its schema does not declare", () => {
    it("refuses the boot, naming the module", () => {
      const leaking = defineBrowserConfig({
        schema: mailWebConfigSchema,
        project: (config: unknown) => ({
          email: Boolean(mailSlice.parse(config).provider),
          apiKey: "sk-must-not-reach-the-page",
        }),
      });

      expect(() =>
        projectPublicConfig({
          modules: [{ name: "mail", publicConfig: leaking.project }],
          config: parsedConfig(),
        }),
      ).toThrow(/"mail"/);
    });
  });

  describe("when a module claims the process owner's namespace", () => {
    it("refuses the boot rather than overwriting the process slice", () => {
      expect(() =>
        projectPublicConfig({
          modules: [{ name: "process", publicConfig: mailBrowserConfig.project }],
          config: parsedConfig(),
        }),
      ).toThrow(/"process"/);
    });
  });

  describe("when a module's config claims a key declared as a secret", () => {
    it("refuses the boot before any projection could read it", () => {
      const claimsSecret = Config.define((c) => ({
        apiKey: c.env("SENDGRID_API_KEY", z.string().optional()),
      }));

      expect(() =>
        parseProcessConfig({
          owners: [
            { name: "mail", config: claimsSecret },
            { name: "notification", secrets: { key: Secret.load("SENDGRID_API_KEY") } },
          ],
          environment: { SENDGRID_API_KEY: "sk-private" },
        }),
      ).toThrow(expect.objectContaining({ code: "config_claims_secret" }));
    });
  });
});
