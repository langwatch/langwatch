import { afterAll, describe, expect, it } from "vitest";

import { serviceDoesNotOpenAChannelRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";
const CHANNEL = "modules/agent/process/src/channels/eventing/eventing.agent.channel.ts";

function report(code, filename = SERVICE) {
  return runRule(serviceDoesNotOpenAChannelRule, { code, cwd: workspace.cwd, filename });
}

describe("given a service module", () => {
  describe("when it imports what constructs the bus or a queue processor", () => {
    /** @scenario "A service may not open the event bus" */
    it("reports serviceOpensAChannel once per import, naming the constructors", () => {
      const code = [
        'import { createTenantId } from "@langwatch/eventing";',
        'import { EventSourcing, mapCommands, type EventSourcedQueueProcessor } from "@langwatch/eventing";',
        'import { EventingServerRuntime } from "@langwatch/eventing/server";',
      ].join("\n");

      expect(report(code).map(({ data, line, messageId }) => ({ data, line, messageId }))).toEqual([
        {
          data: {
            conduit: "the event bus",
            specifier: "EventSourcing, mapCommands",
            tier: "eventing",
          },
          line: 2,
          messageId: "serviceOpensAChannel",
        },
        {
          data: { conduit: "the event bus", specifier: "EventingServerRuntime", tier: "eventing" },
          line: 3,
          messageId: "serviceOpensAChannel",
        },
      ]);
    });
  });

  describe("when it imports eventing helpers, errors and types", () => {
    /** @scenario "A service may use eventing helpers without opening the bus" */
    it("reports nothing", () => {
      const code = [
        'import { createTenantId, defineCommand, defineCommandSchema, EventUtils } from "@langwatch/eventing";',
        'import { DispatchError, isDispatchError, type TenantId } from "@langwatch/eventing";',
        'import type { EventSourcing } from "@langwatch/eventing";',
        'import type { ScheduledJobFire } from "@langwatch/eventing/server";',
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when it reaches a vendor over HTTP", () => {
    /** @scenario "A service may not reach a vendor over HTTP" */
    it("reports serviceOpensAChannel for the client, a bare fetch and globalThis.fetch", () => {
      const code = [
        'import { request } from "undici";',
        "export const call = () => fetch(url);",
        "export const viaGlobal = () => globalThis.fetch(url);",
        'export const computed = () => globalThis["fetch"](url);',
      ].join("\n");

      expect(report(code).map(({ line, messageId }) => ({ line, messageId }))).toEqual([
        { line: 1, messageId: "serviceOpensAChannel" },
        { line: 2, messageId: "serviceOpensAChannel" },
        { line: 3, messageId: "serviceOpensAChannel" },
        { line: 4, messageId: "serviceOpensAChannel" },
      ]);
    });
  });

  describe("when it imports a Redis client", () => {
    /** @scenario "A Redis client is store-containment's, not this rule's" */
    it("reports nothing", () => {
      expect(report('import Redis from "ioredis";')).toEqual([]);
    });
  });

  describe("when it sends email or posts to Slack", () => {
    /** @scenario "A service may not send email or post to Slack" */
    it("reports serviceOpensAChannel for each sender", () => {
      expect(report('import { Resend } from "resend";').map((e) => e.data.conduit)).toEqual([
        "a mail sender",
      ]);
      expect(
        report('import { WebClient } from "@slack/web-api";').map((e) => e.data.conduit),
      ).toEqual(["Slack"]);
      expect(
        report('import { S3Client } from "@aws-sdk/client-s3";').map((e) => e.data.conduit),
      ).toEqual(["an AWS client"]);
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
