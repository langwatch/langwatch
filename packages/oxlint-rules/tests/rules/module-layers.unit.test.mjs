import { afterAll, describe, expect, it } from "vitest";

import { moduleLayersRule } from "../../src/rules/module-layers.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const PROCESS = "modules/agent/process/src";
const REPOSITORY = `${PROCESS}/repositories/prisma/prisma.agent.repository.ts`;
const CHANNEL = `${PROCESS}/channels/slack/slack.agent.channel.ts`;
const TRANSPORT = `${PROCESS}/transport/agent.rest.ts`;
const SERVICE = `${PROCESS}/services/agent.service.ts`;

function report(filename, code) {
  return runRule(moduleLayersRule, { code, cwd: workspace.cwd, filename }).map(
    ({ data, line, messageId }) => ({ crossed: data.crossed, line, messageId }),
  );
}

describe("given a repository", () => {
  describe("when it value-imports a service, the app or a pipeline artifact", () => {
    /** @scenario "A repository takes the store it reads and nothing above it" */
    it("reports repositoryCrossing on each import's line", () => {
      const code = [
        'import { z } from "zod";',
        'import { AgentService } from "../../services/agent.service.ts";',
        'import { AgentApp } from "#app/agent.app";',
        'import { AgentDerived } from "../../eventing/agent-derived.projection.ts";',
      ].join("\n");

      expect(report(REPOSITORY, code)).toEqual([
        { crossed: "a service", line: 2, messageId: "repositoryCrossing" },
        { crossed: "the app", line: 3, messageId: "repositoryCrossing" },
        { crossed: "the eventing pipeline", line: 4, messageId: "repositoryCrossing" },
      ]);
    });
  });

  describe("when it names its siblings, a rules module, an eventing store or a type", () => {
    /** @scenario "A repository takes the store it reads and nothing above it" */
    it("reports nothing", () => {
      const code = [
        'import { AgentRow } from "../agent.repository.ts";',
        'import { agentRules } from "../../rules/agent.rules.ts";',
        'import { AgentStore } from "../../eventing/agent-item.store.ts";',
        'import type { AgentService } from "../../services/agent.service.ts";',
        'import { type AgentApp } from "../../app/agent.app.ts";',
      ].join("\n");

      expect(report(REPOSITORY, code)).toEqual([]);
    });
  });
});

describe("given a channel", () => {
  /** @scenario "A channel takes the client it speaks to" */
  it("reports channelCrossing for a repository or a service and passes its own client", () => {
    const code = [
      'import { WebClient } from "@slack/web-api";',
      'import { agentRepository } from "../../repositories/agent.repository.ts";',
      'import { AgentService } from "../../services/agent.service.ts";',
      'import { render } from "../teams/teams.agent.channel.ts";',
    ].join("\n");

    expect(report(CHANNEL, code)).toEqual([
      { crossed: "a repository", line: 2, messageId: "channelCrossing" },
      { crossed: "a service", line: 3, messageId: "channelCrossing" },
    ]);
  });
});

describe("given a transport", () => {
  /** @scenario "A transport never names a repository, even as a type" */
  it("reports transportCrossing for a repository by path or alias, value or type", () => {
    const code = [
      'import { agentRules } from "../rules/agent.rules.ts";',
      'import type { AgentRepository } from "../repositories/agent.repository.ts";',
      'import { RedisAgentRuntime } from "#repositories/redis/redis.agent-runtime.repository";',
    ].join("\n");

    expect(report(TRANSPORT, code)).toEqual([
      { crossed: "a repository", line: 2, messageId: "transportCrossing" },
      { crossed: "a repository", line: 3, messageId: "transportCrossing" },
    ]);
  });

  /** @scenario "A transport never names a service or a channel, even as a type" */
  it("reports transportCrossing for a service or a channel, value or type, and passes app and contract", () => {
    const code = [
      'import { agentInput } from "@langwatch/agent-contract";',
      'import type { AgentApi } from "../app/agent.app.ts";',
      'import { AgentService } from "../services/agent.service.ts";',
      'import type { AgentChannel } from "#channels/agent.channel";',
      "import {",
      "  type SlackAgentChannel,",
      '} from "../channels/slack/slack.agent.channel.ts";',
    ].join("\n");

    expect(report(TRANSPORT, code)).toEqual([
      { crossed: "a service", line: 3, messageId: "transportCrossing" },
      { crossed: "a channel", line: 4, messageId: "transportCrossing" },
      { crossed: "a channel", line: 5, messageId: "transportCrossing" },
    ]);
  });
});

describe("given a service", () => {
  /** @scenario "A service works over repository interfaces, never a backend" */
  it("reports serviceNamesABackend for a backend, value or type, and passes the interface", () => {
    const code = [
      'import type { AgentRepository } from "../repositories/agent.repository.ts";',
      'import { PrismaAgentRepository } from "../repositories/prisma/prisma.agent.repository.ts";',
      "import {",
      "  type ClickHouseAgentRepository,",
      '} from "#repositories/clickhouse/clickhouse.agent.repository";',
    ].join("\n");

    expect(report(SERVICE, code)).toEqual([
      { crossed: "a repository backend", line: 2, messageId: "serviceNamesABackend" },
      { crossed: "a repository backend", line: 3, messageId: "serviceNamesABackend" },
    ]);
  });

  /** @scenario "A service works over channel interfaces, never a tier implementation" */
  it("reports serviceNamesAChannelImplementation for a tier or memory twin and passes the interface", () => {
    const code = [
      'import type { AgentChannel } from "../channels/agent.channel.ts";',
      'import { SlackAgentChannel } from "../channels/slack/slack.agent.channel.ts";',
      'import type { MemoryAgentChannel } from "#channels/memory/memory.agent.channel";',
    ].join("\n");

    expect(report(SERVICE, code)).toEqual([
      {
        crossed: "a channel implementation",
        line: 2,
        messageId: "serviceNamesAChannelImplementation",
      },
      {
        crossed: "a channel implementation",
        line: 3,
        messageId: "serviceNamesAChannelImplementation",
      },
    ]);
  });
});

describe("given a test beside a repository", () => {
  /** @scenario "A test composing a layer is not this rule's business" */
  it("reports nothing", () => {
    expect(
      report(
        `${PROCESS}/repositories/__tests__/agent.repository.unit.test.ts`,
        'import { AgentService } from "../../services/agent.service.ts";',
      ),
    ).toEqual([]);
  });
});
