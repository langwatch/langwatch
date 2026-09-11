import { afterAll, describe, expect, it } from "vitest";
import { channelTakesOnlyItsClientRule, repositoryTakesOnlyItsStoreRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const REPOSITORY = "modules/agent/server/src/repositories/prisma/prisma.agent.repository.ts";
const CHANNEL = "modules/agent/server/src/channels/slack/slack.agent.channel.ts";

function fromRepository(code) {
  return runRule(repositoryTakesOnlyItsStoreRule, {
    code,
    cwd: workspace.cwd,
    filename: REPOSITORY,
  });
}

function fromChannel(code) {
  return runRule(channelTakesOnlyItsClientRule, { code, cwd: workspace.cwd, filename: CHANNEL });
}

describe("given a repository", () => {
  describe("when it calls a service", () => {
    /** @scenario "A repository takes the store it reads and nothing above it" */
    it("reports repositoryTakesMoreThanItsStore naming the layer", () => {
      const found = fromRepository('import { AgentService } from "../../services/agent.service.js";');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("repositoryTakesMoreThanItsStore");
      expect(found[0].data.crossed).toBe("a service");
    });
  });

  describe("when it reaches the app or a transport", () => {
    /** @scenario "A repository takes the store it reads and nothing above it" */
    it("reports both crossings", () => {
      expect(fromRepository('import { AgentApp } from "../../app/agent.app.js";')[0].data.crossed).toBe(
        "the app",
      );
      expect(
        fromRepository('import { agentRest } from "../../transport/agent.rest.js";')[0].data.crossed,
      ).toBe("a transport");
    });
  });

  describe("when it imports another module's server package", () => {
    /** @scenario "Outside its package a module is its App" */
    it("reports the crossing as another module", () => {
      const found = fromRepository('import { traceServer } from "@langwatch/trace-server";');

      expect(found[0].data.crossed).toBe("another module");
    });
  });

  describe("when it names its own store and its sibling repositories", () => {
    /** @scenario "A repository takes the store it reads and nothing above it" */
    it("reports nothing", () => {
      expect(fromRepository('import { PrismaRepository } from "@langwatch/prisma-repository";')).toHaveLength(0);
      expect(fromRepository('import { AgentRow } from "../agent.repository.js";')).toHaveLength(0);
      expect(fromRepository('import type { AgentService } from "../../services/agent.service.js";')).toHaveLength(0);
    });
  });
});

describe("given a channel", () => {
  describe("when it reads a repository", () => {
    /** @scenario "A channel takes the client it speaks to" */
    it("reports channelTakesMoreThanItsClient naming the layer", () => {
      const found = fromChannel('import { agentRepository } from "../../repositories/agent.repository.js";');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("channelTakesMoreThanItsClient");
      expect(found[0].data.crossed).toBe("a repository");
    });
  });

  describe("when it opens the database itself", () => {
    /** @scenario "A channel takes the client it speaks to" */
    it("reports the database client", () => {
      expect(fromChannel('import { PrismaClient } from "@prisma/client";')[0].data.crossed).toBe(
        "the database client",
      );
    });
  });

  describe("when it takes the client it speaks to", () => {
    /** @scenario "A channel takes the client it speaks to" */
    it("reports nothing", () => {
      expect(fromChannel('import { WebClient } from "@slack/web-api";')).toHaveLength(0);
      expect(fromChannel('import { render } from "../teams/teams.agent.channel.js";')).toHaveLength(0);
    });
  });
});
