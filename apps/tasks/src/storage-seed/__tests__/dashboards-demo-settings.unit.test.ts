/**
 * What a dashboards demo run is told by its environment, and the deployments and endpoints the
 * task refuses before it reads or writes anything.
 * @see specs/setup/dashboards-demo-seed.feature
 */
import { SecretsChain } from "@langwatch/secrets";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveTasksConfig } from "../../config.ts";
import { runTasks } from "../../main.ts";
import { dashboardsDemoSettings } from "../dashboards-demo-settings.ts";

const DEV = { nodeEnvironment: "development", isSaaS: false } as const;
/** The runner loads the task's whole graph on first use, which a busy machine is slow to do. */
const TASK_TIMEOUT_MS = 120_000;

const settingsFor = (environment: Record<string, string>) =>
  dashboardsDemoSettings({ environment, config: DEV });

/** The task as the runner starts it, over a database and a network that answer nothing. */
function taskInput({
  deployment,
  environment = {},
}: {
  deployment: Record<string, string>;
  environment?: Record<string, string>;
}) {
  return {
    config: resolveTasksConfig(deployment),
    connections: {
      database: {
        // Nothing is scripted, so any read or write of the database throws by name.
        client: prismaDouble(),
        sql: undefined as never,
        hold: (run: () => Promise<void>) => run(),
        close: async () => void 0,
      },
      redis: null,
    },
    chain: SecretsChain.start({ environment: {} }),
    environment,
    signal: new AbortController().signal,
  };
}

describe("given the environment a dashboards demo run starts with", () => {
  describe("when it names a size", () => {
    /** @scenario "The size flag sets the volume" */
    it("multiplies each agent's daily volume by 0.3, 1 or 6", () => {
      const scales = ["small", "medium", "large"].map(
        (size) => settingsFor({ DASHBOARDS_DEMO_SIZE: size }).scale,
      );

      expect(scales).toEqual([0.3, 1, 6]);
    });

    /** @scenario "The size flag sets the volume" */
    it("refuses any other size, naming the flag and the sizes it takes", () => {
      expect(() => settingsFor({ DASHBOARDS_DEMO_SIZE: "huge" })).toThrow(
        "DASHBOARDS_DEMO_SIZE must be one of small, medium, large",
      );
    });
  });

  describe("when it names nothing", () => {
    /** @scenario "The size flag sets the volume" */
    it("sends 60 days at the medium size to the local stack, for the local-dev admin", () => {
      expect(settingsFor({})).toEqual({
        endpoint: "http://localhost:6560",
        days: 60,
        size: "medium",
        scale: 1,
        userEmail: undefined,
      });
    });
  });

  describe("when it names how many days of history", () => {
    /** @scenario "The size flag sets the volume" */
    it("sends that many, and refuses a count the stack could not keep", () => {
      expect(settingsFor({ DASHBOARDS_DEMO_DAYS: "14" }).days).toBe(14);
      expect(() => settingsFor({ DASHBOARDS_DEMO_DAYS: "400" })).toThrow("DASHBOARDS_DEMO_DAYS");
      expect(() => settingsFor({ DASHBOARDS_DEMO_DAYS: "a week" })).toThrow("DASHBOARDS_DEMO_DAYS");
    });
  });

  describe("when the endpoint is a local host", () => {
    /** @scenario "The seed refuses a stack that is not local" */
    it("accepts localhost, the loopback addresses and any .localhost host", () => {
      const endpoints = [
        "http://localhost:6560/",
        "http://127.0.0.1:6560",
        "http://[::1]:6560",
        "https://app.my-branch.langwatch.localhost/",
      ].map((endpoint) => settingsFor({ DASHBOARDS_DEMO_ENDPOINT: endpoint }).endpoint);

      expect(endpoints).toEqual([
        "http://localhost:6560",
        "http://127.0.0.1:6560",
        "http://[::1]:6560",
        "https://app.my-branch.langwatch.localhost",
      ]);
    });
  });

  describe("when the endpoint is not a local host", () => {
    /** @scenario "The seed refuses a stack that is not local" */
    it("refuses, naming the host", () => {
      for (const host of ["app.example.com", "localhost.example.com", "10.0.0.12"]) {
        expect(() => settingsFor({ DASHBOARDS_DEMO_ENDPOINT: `https://${host}` })).toThrow(
          `Refusing to seed: DASHBOARDS_DEMO_ENDPOINT host "${host}" is not local`,
        );
      }
    });

    /** @scenario "The seed refuses a stack that is not local" */
    it("refuses an endpoint that is no URL", () => {
      expect(() => settingsFor({ DASHBOARDS_DEMO_ENDPOINT: "the staging stack" })).toThrow(
        "Refusing to seed: DASHBOARDS_DEMO_ENDPOINT is not a valid URL",
      );
    });
  });

  describe("when the deployment is production or SaaS", () => {
    /** @scenario "The seed refuses a production or SaaS deployment" */
    it("refuses, whatever the endpoint", () => {
      for (const config of [
        { nodeEnvironment: "production", isSaaS: false } as const,
        { nodeEnvironment: "development", isSaaS: true } as const,
      ]) {
        expect(() => dashboardsDemoSettings({ environment: {}, config })).toThrow(
          "Refusing to seed: the dashboards demo is a dev fixture",
        );
      }
    });
  });
});

describe("given the runner is asked for the dashboards-demo-seed task", () => {
  let requests: string[];

  beforeEach(() => {
    requests = [];
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      requests.push(String(input instanceof Request ? input.url : input));
      return Promise.resolve(Response.json({}));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when the deployment is production", () => {
    /** @scenario "The seed refuses a production or SaaS deployment" */
    it(
      "stops before it reads the database or calls the stack",
      { timeout: TASK_TIMEOUT_MS },
      async () => {
        const input = taskInput({ deployment: { NODE_ENV: "production" } });

        await expect(runTasks(["dashboards-demo-seed"], input)).rejects.toThrow(
          "Refusing to seed: the dashboards demo is a dev fixture",
        );
        expect(requests).toEqual([]);
      },
    );
  });

  describe("when the deployment is SaaS", () => {
    /** @scenario "The seed refuses a production or SaaS deployment" */
    it(
      "stops before it reads the database or calls the stack",
      { timeout: TASK_TIMEOUT_MS },
      async () => {
        const input = taskInput({ deployment: { NODE_ENV: "development", IS_SAAS: "1" } });

        await expect(runTasks(["dashboards-demo-seed"], input)).rejects.toThrow(
          "Refusing to seed: the dashboards demo is a dev fixture",
        );
        expect(requests).toEqual([]);
      },
    );
  });

  describe("when the endpoint names a stack that is not local", () => {
    /** @scenario "The seed refuses a stack that is not local" */
    it(
      "stops before it reads the database or calls the stack",
      { timeout: TASK_TIMEOUT_MS },
      async () => {
        const input = taskInput({
          deployment: { NODE_ENV: "development" },
          environment: { DASHBOARDS_DEMO_ENDPOINT: "https://app.example.com" },
        });

        await expect(runTasks(["dashboards-demo-seed"], input)).rejects.toThrow(
          'DASHBOARDS_DEMO_ENDPOINT host "app.example.com" is not local',
        );
        expect(requests).toEqual([]);
      },
    );
  });

  describe("when no user has the email the run names", () => {
    /** @scenario "A missing demo user refuses by name" */
    it(
      "stops before it writes anything, naming the email",
      { timeout: TASK_TIMEOUT_MS },
      async () => {
        const base = taskInput({
          deployment: { NODE_ENV: "development" },
          environment: { DASHBOARDS_DEMO_USER_EMAIL: "nobody@example.dev" },
        });
        // Only the member lookup answers, so any write that followed would throw by name instead.
        const client = prismaDouble({ user: { findFirst: async () => null } });
        const input = {
          ...base,
          connections: { ...base.connections, database: { ...base.connections.database, client } },
        };

        await expect(runTasks(["dashboards-demo-seed"], input)).rejects.toThrow(
          "No user has the email nobody@example.dev",
        );
        expect(requests).toEqual([]);
      },
    );
  });
});
