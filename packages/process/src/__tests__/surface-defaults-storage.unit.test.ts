import { TransportSelection } from "@langwatch/api/hosting";
import { parseProcessConfig } from "@langwatch/config";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import { ProcessServer } from "../process-server.ts";

/** The page policy the api serves, from the env the way the process parses it at boot. */
const pagePolicyFor = (environment: Record<string, string | undefined>) => {
  const config = parseProcessConfig({ owners: processConfig([], "api"), environment });
  const server = ProcessServer.create({
    name: "surface-defaults-test",
    logger: createTestLogger().logger,
    config,
    resolver: SecretsResolver.over(SecretsChain.start({ environment }).withEnv()),
    ownsProcess: false,
    modules: [],
  });
  const { bundle } = TransportSelection.create(server.surfaceDefaults).browserBundle().selected;
  if (!bundle) throw new Error("the browser bundle was selected");
  return bundle.security.read("Content-Security-Policy") ?? "";
};

describe("the browser page policy", () => {
  describe("given a shared S3 bucket behind an explicit endpoint", () => {
    describe("when the api composes its page policy", () => {
      it("admits the bucket's origin to connect-src, so a presigned upload is sent", () => {
        const policy = pagePolicyFor({
          NODE_ENV: "production",
          S3_BUCKET_NAME: "uploads",
          S3_ENDPOINT: "https://uploads.s3.eu-central-1.amazonaws.com",
        });
        const connect = policy.split(";").find((part) => part.trim().startsWith("connect-src"));

        expect(connect).toContain("https://uploads.s3.eu-central-1.amazonaws.com");
      });
    });
  });

  describe("given a production install whose BASE_HOST is plain http", () => {
    describe("when the api composes its page policy", () => {
      /** @scenario "A self-hosted install over plain HTTP is not forced onto HTTPS" */
      it("leaves out upgrade-insecure-requests, so the browser keeps the page on http", () => {
        const policy = pagePolicyFor({
          NODE_ENV: "production",
          BASE_HOST: "http://langwatch.internal:5560",
        });

        expect(policy).toContain("default-src");
        expect(policy).not.toContain("upgrade-insecure-requests");
      });
    });
  });

  describe("given a production install whose BASE_HOST is https", () => {
    describe("when the api composes its page policy", () => {
      /** @scenario "An HTTPS production install forces HTTPS on the browser" */
      it("keeps upgrade-insecure-requests", () => {
        const policy = pagePolicyFor({
          NODE_ENV: "production",
          BASE_HOST: "https://langwatch.example.com",
        });

        expect(policy).toContain("upgrade-insecure-requests");
      });
    });
  });
});
