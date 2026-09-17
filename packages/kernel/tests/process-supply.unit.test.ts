import { describe, expect, it } from "vitest";

import { defineServerModule } from "../src/feature-installer.ts";
import { createApp as packageCreateApp, SupplyToken, supplyToken } from "../src/index.ts";
import { createApp } from "../src/process-supply.ts";
import {
  clock,
  clockModule,
  ClockApp,
  connections,
  connectionsModule,
  configModule,
  peerModule,
  project,
  projectModule,
  repositoryModule,
  facilities,
  licenseConsumerModule,
  licenseSource,
  memoryRepositoryModule,
} from "./process-supply.fixtures.ts";

const transportedClockModule = defineServerModule("annotation")
  .withApp(ClockApp)
  .withTransports(
    { protocol: "rest", router: () => ({ family: "clock" }) },
    { protocol: "trpc", namespace: "clock", router: () => ({ procedure: "now" }) },
  );

describe("process supply", () => {
  /** @scenario "A process installing one module is asked only for that module's needs" */
  it("boots with only the clock its module reads", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([clockModule])
      .withClock(clock)
      .boot();
    expect(runtime.module(clockModule).provided.now()).toBe("frozen");
    expect(Object.keys(runtime.members)).toEqual(["clock"]);
    await runtime.stop();
  });

  /** @scenario "A module that keeps no analytical state never asks for one" */
  it("boots a stateless module without any store", async () => {
    const runtime = await createApp({ role: "worker" }).withModules([projectModule]).boot();
    expect(runtime.module(projectModule).provided.getById("one")).toBe("project:one");
    expect(runtime.members).toEqual({});
    await runtime.stop();
  });

  /** @scenario "Installing the module that owns a capability satisfies its dependents" */
  it("resolves a peer installed after its dependent", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([peerModule])
      .withModules([projectModule])
      .boot();
    expect(runtime.module(peerModule).provided.read("one")).toBe("project:one");
    await runtime.stop();
  });

  /** @scenario "Standing in for a module that is not installed" */
  it("resolves a keyed peer supplied before its dependent", async () => {
    const runtime = await createApp({ role: "api" })
      .provide({ project })
      .withModules([peerModule])
      .boot();
    expect(runtime.module(peerModule).provided.read("one")).toBe("project:one");
    await runtime.stop();
  });

  it("hands a supplied config slice to the module", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([configModule])
      .withConfig({ "api-key": { pepper: "test-pepper" } })
      .boot();
    expect(runtime.module(configModule).provided.pepper()).toBe("test-pepper");
    await runtime.stop();
  });

  it("supplies the store declared by a repository", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([repositoryModule])
      .withRelational(facilities.relational)
      .withClock(clock)
      .boot();
    expect(runtime.module(repositoryModule).provided.row()).toBe("rows@frozen");
    await runtime.stop();
  });

  it("requires only the selected memory repository tier", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([memoryRepositoryModule])
      .withClock(clock)
      .boot();
    expect(runtime.module(memoryRepositoryModule).provided.row()).toBe("memory@frozen");
    await runtime.stop();
  });

  it("hands a module its declared custom member", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([connectionsModule])
      .withMember("connections", connections)
      .boot();
    expect(runtime.module(connectionsModule).provided.primary()).toBe("primary");
    expect(runtime.members).toEqual({ connections });
    await runtime.stop();
  });

  it("resolves a process-provided supply token outside the module namespace", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([licenseConsumerModule])
      .provide({ licenseSource })
      .boot();
    expect(runtime.module(licenseConsumerModule).provided.plan()).toBe("pro");
    await runtime.stop();
  });

  it("exports the process supply chain as the package createApp", () => {
    expect(packageCreateApp).toBe(createApp);
    const token = supplyToken<{ resolve(): string }>()("licenseSource");
    expect(token).toBeInstanceOf(SupplyToken);
    expect(token.name).toBe("licenseSource");
    expect(Object.isFrozen(token)).toBe(true);
  });

  it("keeps builder branches independent", async () => {
    const base = createApp({ role: "api" }).withModules([clockModule]);
    const first = base.withClock(() => "first");
    const second = base.withClock(() => "second");
    const [a, b] = await Promise.all([first.boot(), second.boot()]);
    expect(a.module(clockModule).provided.now()).toBe("first");
    expect(b.module(clockModule).provided.now()).toBe("second");
    await Promise.all([a.stop(), b.stop()]);
  });

  it("opens REST and tRPC hosts from the declared transport auth", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([transportedClockModule])
      .withClock(clock)
      .withTransportAuth(
        (auth) => auth.withStaticTokens({ cron: "cron-secret" }),
        (peers, auth) => {
          const clockApi = peers.app(ClockApp.contract);

          return {
            rest: {
              mount: () => ({
                protocol: "rest" as const,
                cron: auth.staticTokens.cron,
                now: clockApi.now(),
              }),
            },
            trpc: {
              mount: () => ({
                protocol: "trpc" as const,
                cron: auth.staticTokens.cron,
                now: clockApi.now(),
              }),
            },
          };
        },
      )
      .boot();

    expect(runtime.transports.rest).toEqual([
      { protocol: "rest", cron: "cron-secret", now: "frozen" },
    ]);
    expect(runtime.transports.trpc).toEqual({
      clock: { protocol: "trpc", cron: "cron-secret", now: "frozen" },
    });
    await runtime.stop();
  });

  it("starts process services in declaration order and stops them in reverse", async () => {
    const events: string[] = [];
    const service = (name: string) => ({
      name,
      start: () => {
        events.push(`${name}:start`);
      },
      stop: () => {
        events.push(`${name}:stop`);
      },
    });
    const runtime = await createApp({ role: "worker" })
      .withService(service("producer"))
      .withService(service("listener"))
      .boot();

    expect(events).toEqual([]);
    await runtime.start();
    await runtime.stop();
    expect(events).toEqual(["producer:start", "listener:start", "listener:stop", "producer:stop"]);
  });
});
