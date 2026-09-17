import { describe, expect, it } from "vitest";

import { createApp } from "../src/process-supply.ts";
import {
  clock,
  clockModule,
  configModule,
  peerModule,
  project,
  projectModule,
  repositoryModule,
  facilities,
} from "./process-supply.fixtures.ts";

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

  it("keeps builder branches independent", async () => {
    const base = createApp({ role: "api" }).withModules([clockModule]);
    const first = base.withClock(() => "first");
    const second = base.withClock(() => "second");
    const [a, b] = await Promise.all([first.boot(), second.boot()]);
    expect(a.module(clockModule).provided.now()).toBe("first");
    expect(b.module(clockModule).provided.now()).toBe("second");
    await Promise.all([a.stop(), b.stop()]);
  });
});
