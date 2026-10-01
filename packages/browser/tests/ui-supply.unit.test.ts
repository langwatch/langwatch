import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  BrowserConfigMissingError,
  BrowserConfigRefusedError,
  BrowserMountMissingError,
  BrowserSupplyMissingError,
  createUi,
  defineWebModule,
} from "../src/index.ts";
import {
  browserUiTransport,
  configModule,
  documentRoot,
  mountElement,
  publicAppConfig,
  transportModule,
} from "./ui-supply.fixtures.ts";

describe("UI supply", () => {
  it("resolves a complete composition without reading undeclared config", async () => {
    const reader = vi.fn(() => publicAppConfig);
    const rendered = await createUi({ document: documentRoot, mount: "root" })
      .withModules([transportModule])
      .withInjectedConfig(reader)
      .withTransport(browserUiTransport)
      .render();

    expect(reader).not.toHaveBeenCalled();
    expect(rendered.mount).toBe(mountElement);
    expect(rendered.config).toEqual({});
    expect(rendered.modules.map((module) => module.name)).toEqual(["screen"]);
  });

  it("reads and parses every declared config slice before resolving", async () => {
    const secondConfig = defineWebModule("second-config").withConfig({
      notification: z.strictObject({ email: z.boolean() }),
    });
    const reader = vi.fn(() => publicAppConfig);

    const rendered = await createUi({ document: documentRoot, mount: "root" })
      .withModules([configModule, secondConfig])
      .withInjectedConfig(reader)
      .render();

    expect(reader).toHaveBeenCalledOnce();
    expect(reader).toHaveBeenCalledWith(documentRoot);
    expect(rendered.config).toEqual({
      configuration: { process: { mode: "test" } },
      "second-config": { notification: { email: true } },
    });
  });

  it("names a reader failure without exposing its cause", async () => {
    const render = createUi({ document: documentRoot, mount: "root" })
      .withModules([configModule])
      .withInjectedConfig(() => {
        throw new Error("decoded private value");
      })
      .render();

    await expect(render).rejects.toMatchObject({ code: "browser_config_missing" });
    await expect(render).rejects.not.toHaveProperty("cause");
    await expect(render).rejects.toBeInstanceOf(BrowserConfigMissingError);
  });

  it("names the module refusing a slice and never repeats the value", async () => {
    const refusing = defineWebModule("refusing").withConfig({
      process: z.strictObject({ mode: z.string().refine((mode) => mode === "production") }),
    });
    const render = createUi({ document: documentRoot, mount: "root" })
      .withModules([refusing])
      .withInjectedConfig(() => publicAppConfig)
      .render();

    const error = await render.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BrowserConfigRefusedError);
    expect(error).toMatchObject({ code: "browser_config_refused", module: "refusing" });
    expect(String(error)).not.toContain('"test"');
  });

  it("keeps builder branches independent", async () => {
    const base = createUi({ document: documentRoot, mount: "root" }).withModules([transportModule]);
    const firstTransport = { name: "first" };
    const secondTransport = { name: "second" };
    const [first, second] = await Promise.all([
      base.withTransport(firstTransport).render(),
      base.withTransport(secondTransport).render(),
    ]);

    expect(first.supplied.transport).toBe(firstTransport);
    expect(second.supplied.transport).toBe(secondTransport);
  });

  it("refuses a missing mount by name", async () => {
    const render = createUi({ document: documentRoot, mount: "absent" }).render();

    await expect(render).rejects.toBeInstanceOf(BrowserMountMissingError);
    await expect(render).rejects.toMatchObject({ code: "browser_mount_missing", mount: "absent" });
  });

  it("names every outstanding supply when render is laundered through instanceof Function", async () => {
    const incomplete = createUi({ document: documentRoot, mount: "root" }).withModules([
      transportModule,
    ]);

    if (!(incomplete.render instanceof Function)) {
      throw new Error("the instanceof Function launder no longer compiles as callable");
    }
    const render = incomplete.render();

    await expect(render).rejects.toBeInstanceOf(BrowserSupplyMissingError);
    await expect(render).rejects.toMatchObject({
      code: "browser_supply_missing",
      missing: ["transport"],
    });
  });

  it("refuses Object.assign onto render with a TypeError", () => {
    const incomplete = createUi({ document: documentRoot, mount: "root" }).withModules([
      transportModule,
    ]);

    expect(() => Object.assign(incomplete, { render: async () => ({}) })).toThrow(TypeError);
  });
});
