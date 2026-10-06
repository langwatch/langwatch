import { describe, expect, it, vi } from "vitest";

import { ApplicationBuilder } from "../src/application.ts";
import { serverFeature } from "../src/feature-installer.ts";
import { Server } from "../src/server.ts";
import { memberSourceOf } from "./member-source.ts";

const logger = { info: vi.fn(), error: vi.fn() };

/** A runtime whose one feature owns a service and a resource, recording both. */
async function bootRuntime({
  role,
  events,
  drainFails = false,
  onDrain = () => {},
}: {
  role: "api" | "worker";
  events: string[];
  drainFails?: boolean;
  onDrain?: () => Promise<void> | void;
}) {
  const feature = serverFeature<object>("jobs")
    .withSetup(({ resources }) => {
      resources.ownService({
        name: "feature consumers",
        start: () => {},
        stop: async () => {
          await onDrain();
          events.push("feature work drained");
          if (drainFails) throw new Error("drain failed");
        },
      });
      return {};
    })
    .withClose(() => {
      events.push("feature closed");
    })
    .build();

  return new ApplicationBuilder({ role, members: memberSourceOf({}) })
    .withModules([feature])
    .boot();
}

/** Hosted before the application, as the preamble hosts them, so they stop after it. */
function hostInfrastructure(server: Server, events: string[]): void {
  server.with({
    name: "telemetry",
    stop: () => {
      events.push("telemetry flushed");
    },
  });
  server.with({
    name: "infrastructure",
    stop: () => {
      events.push("infrastructure released");
    },
  });
}

describe("closing a served process", () => {
  describe("given a worker application serving feature consumers", () => {
    describe("when the server closes", () => {
      /** @scenario "Shutdown drains in-flight work before releasing infrastructure" */
      it("drains the consumers, closes the features, then releases the infrastructure", async () => {
        const events: string[] = [];
        const runtime = await bootRuntime({ role: "worker", events });
        const server = Server.create({ name: "worker", logger, ownsProcess: false });
        hostInfrastructure(server, events);
        await server.run({
          name: "worker",
          start: () => runtime.start(),
          stop: () => runtime.stop(),
        });

        await server.close();

        expect(events.slice(0, 2)).toEqual(["feature work drained", "feature closed"]);
        expect(events).toContain("infrastructure released");
        expect(events.indexOf("infrastructure released")).toBeGreaterThan(
          events.indexOf("feature closed"),
        );
      });
    });
  });

  describe("given an API process serving a listener and feature services", () => {
    async function serveApi({ drainFails }: { drainFails: boolean }) {
      const events: string[] = [];
      const server = Server.create({ name: "api", logger, ownsProcess: false });
      hostInfrastructure(server, events);
      const address = () => {
        const bound = server.healthAddress;
        if (bound === null || typeof bound === "string") throw new Error("no IP port");
        return bound.port;
      };
      const runtime = await bootRuntime({
        role: "api",
        events,
        drainFails,
        onDrain: async () => {
          const refused = await fetch(`http://127.0.0.1:${address()}/api/things`);
          events.push(`intake answers ${refused.status}`);
        },
      });
      await server.serve({
        name: "api",
        start: () => runtime.start(),
        stop: () => runtime.stop(),
        handler: (_request: unknown, response: { writeHead(status: number): { end(): void } }) => {
          response.writeHead(200).end();
        },
      });
      return { events, server };
    }

    describe("when the process closes", () => {
      /**
       * @scenario "Shutdown drains intake, then feature work, then infrastructure"
       * @scenario "The API drains registered services before releasing their infrastructure"
       */
      it("refuses intake first, drains the services, then releases telemetry and infrastructure", async () => {
        const { events, server } = await serveApi({ drainFails: false });

        await server.close();

        expect(events.slice(0, 3)).toEqual([
          "intake answers 503",
          "feature work drained",
          "feature closed",
        ]);
        for (const later of ["telemetry flushed", "infrastructure released"]) {
          expect(events.indexOf(later)).toBeGreaterThan(events.indexOf("feature closed"));
        }
      });

      /** @scenario "The API drains registered services before releasing their infrastructure" */
      it("still releases the infrastructure when a service fails to drain", async () => {
        const { events, server } = await serveApi({ drainFails: true });

        await server.close();

        expect(events).toContain("feature closed");
        expect(events).toContain("telemetry flushed");
        expect(events).toContain("infrastructure released");
      });
    });
  });
});
