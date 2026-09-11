import { afterAll, describe, expect, it } from "vitest";
import { serviceDoesNotOpenAChannelRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/server/src/services/agent.service.ts";
const CHANNEL = "modules/agent/server/src/channels/eventing/eventing.agent.channel.ts";

function report(code, filename = SERVICE) {
  return runRule(serviceDoesNotOpenAChannelRule, { code, cwd: workspace.cwd, filename });
}

describe("given a service module", () => {
  describe("when it imports the event bus", () => {
    /** @scenario "A service may not open the event bus" */
    it("reports serviceOpensAChannel naming the conduit", () => {
      const found = report('import { EventBus } from "@langwatch/eventing";');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("serviceOpensAChannel");
      expect(found[0].data.conduit).toBe("the event bus");
      expect(found[0].data.specifier).toBe("@langwatch/eventing");
    });
  });

  describe("when it reaches a vendor over HTTP", () => {
    /** @scenario "A service may not reach a vendor over HTTP" */
    it("reports serviceOpensAChannel for the client and for a bare fetch", () => {
      expect(report('import { request } from "undici";').map((e) => e.messageId)).toEqual([
        "serviceOpensAChannel",
      ]);
      expect(report("export const call = () => fetch(url);").map((e) => e.messageId)).toEqual([
        "serviceOpensAChannel",
      ]);
    });
  });

  describe("when it publishes on Redis pub/sub", () => {
    /** @scenario "A service may not publish on Redis pub/sub" */
    it("reports serviceOpensAChannel", () => {
      const found = report('import Redis from "ioredis";');

      expect(found).toHaveLength(1);
      expect(found[0].data.conduit).toBe("Redis pub/sub");
    });
  });

  describe("when it sends email or posts to Slack", () => {
    /** @scenario "A service may not send email or post to Slack" */
    it("reports serviceOpensAChannel for each sender", () => {
      expect(report('import { Resend } from "resend";').map((e) => e.data.conduit)).toEqual([
        "a mail sender",
      ]);
      expect(report('import { WebClient } from "@slack/web-api";').map((e) => e.data.conduit)).toEqual([
        "Slack",
      ]);
      expect(report('import { S3Client } from "@aws-sdk/client-s3";').map((e) => e.data.conduit)).toEqual([
        "an AWS client",
      ]);
    });
  });

  describe("when it takes its module's channel interface", () => {
    /** @scenario "A service over a channel interface is allowed" */
    it("reports nothing", () => {
      expect(report('import type { AgentChannel } from "../channels/agent.channel.ts";')).toEqual(
        [],
      );
    });
  });
});

describe("given a channel module", () => {
  describe("when it imports the event bus it wraps", () => {
    /** @scenario "A channel may open the conduit it wraps" */
    it("reports nothing", () => {
      expect(report('import { EventBus } from "@langwatch/eventing";', CHANNEL)).toEqual([]);
    });
  });
});
