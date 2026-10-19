import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

import {
  BrowserConfigMissingError,
  BrowserConfigRefusedError,
  BrowserMountMissingError,
  BrowserSupplyMissingError,
  createUi,
  defineBrowserModule,
  UiFacilitiesSupply,
  UiShellSupply,
} from "../src/index.ts";
import { hostServiceFakes } from "../src/module/ui-host-service-fakes.ts";
import type { UiSupplyName } from "../src/web-module.ts";
import {
  browserUiTransport,
  configModule,
  documentRoot,
  mountElement,
  publicAppConfig,
  sessionModule,
  transportModule,
} from "./ui-supply.fixtures.ts";

/** Render as the build would refuse to call it: the runtime twin of the compile-time check. */
function renderLaundered(supply: { render: unknown }): Promise<unknown> {
  if (!(supply.render instanceof Function)) throw new Error("render is not callable at runtime");
  return Promise.resolve(supply.render()).catch((caught: unknown) => caught);
}

describe("UI supply", () => {
  /** @scenario "A browser installing one module is asked only for that module's needs" */
  it("resolves a complete composition without reading undeclared config", async () => {
    const reader = vi.fn(() => publicAppConfig);
    const rendered = await createUi({ document: documentRoot, mount: "root" })
      .withModules([hostServiceFakes(), transportModule])
      .withInjectedConfig(reader)
      .withTransport(browserUiTransport)
      .render();

    expect(reader).not.toHaveBeenCalled();
    expect(rendered.mount).toBe(mountElement);
    expect(rendered.config).toEqual({});
    expect(rendered.modules.map((module) => module.name)).toEqual(["host-service-fakes", "screen"]);
  });

  /** @scenario "A configuration that parses draws no screen before it is checked" */
  it("reads and parses every declared config slice before resolving", async () => {
    const secondConfig = defineBrowserModule("second-config").withConfig(
      { process: z.object({ mode: z.enum(["development", "test", "production"]) }) },
      ({ process }) => ({ isTest: process.mode === "test" }),
    );
    const reader = vi.fn(() => publicAppConfig);

    const rendered = await createUi({ document: documentRoot, mount: "root" })
      .withModules([hostServiceFakes(), configModule, secondConfig])
      .withInjectedConfig(reader)
      .render();

    expect(reader).toHaveBeenCalledOnce();
    expect(reader).toHaveBeenCalledWith(documentRoot);
    expect(rendered.config).toEqual({
      configuration: { hasEmailProvider: true },
      "second-config": { isTest: true },
    });
    expectTypeOf(rendered.config).toEqualTypeOf<{
      readonly configuration: { hasEmailProvider: boolean };
      readonly "second-config": { isTest: boolean };
    }>();
  });

  /** @scenario "A key no module claims is still refused" */
  it("refuses an owner slice no installed module claims, naming the owner", async () => {
    const render = createUi({ document: documentRoot, mount: "root" })
      .withModules([hostServiceFakes(), configModule])
      .withInjectedConfig(() => ({ ...publicAppConfig, rum: { enabled: true } }))
      .render();

    const error = await render.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BrowserConfigRefusedError);
    expect(error).toMatchObject({ code: "browser_config_refused", owner: "rum" });
  });

  it("admits the process slice unclaimed, and refuses one its schema refuses", async () => {
    const supply = (process: Record<string, unknown>) =>
      createUi({ document: documentRoot, mount: "root" })
        .withModules([hostServiceFakes(), configModule])
        .withInjectedConfig(() => ({ ...publicAppConfig, process }))
        .render();

    await expect(supply(publicAppConfig.process ?? {})).resolves.toBeDefined();
    await expect(supply({ mode: "test" })).rejects.toMatchObject({
      code: "browser_config_refused",
      owner: "process",
    });
  });

  it("names the module whose projection throws", async () => {
    const throwing = defineBrowserModule("throwing").withConfig(
      { notification: z.strictObject({ email: z.boolean() }) },
      () => {
        throw new Error("projection failed");
      },
    );
    const render = createUi({ document: documentRoot, mount: "root" })
      .withModules([hostServiceFakes(), throwing])
      .withInjectedConfig(() => publicAppConfig)
      .render();

    await expect(render).rejects.toMatchObject({
      code: "browser_config_refused",
      module: "throwing",
    });
  });

  /**
   * @scenario "A module whose settings have no projection fails the build"
   * @scenario "A projection naming a field the injected configuration does not carry fails the build"
   */
  it("compiles a claim only with a projection over the fields its owners declare", () => {
    const slices = { notification: z.strictObject({ email: z.boolean() }) };

    // @ts-expect-error a claim with no projection does not compile
    expect(() => defineBrowserModule("unprojected").withConfig(slices)).not.toThrow();
    expect(() =>
      defineBrowserModule("misnamed").withConfig(slices, ({ notification }) => ({
        // @ts-expect-error the notification slice declares no `sms`
        hasSms: notification.sms,
      })),
    ).not.toThrow();
  });

  it("names a reader failure without exposing its cause", async () => {
    const render = createUi({ document: documentRoot, mount: "root" })
      .withModules([hostServiceFakes(), configModule])
      .withInjectedConfig(() => {
        throw new Error("decoded private value");
      })
      .render();

    await expect(render).rejects.toMatchObject({ code: "browser_config_missing" });
    await expect(render).rejects.not.toHaveProperty("cause");
    await expect(render).rejects.toBeInstanceOf(BrowserConfigMissingError);
  });

  /** @scenario "A module refuses the value it was given" */
  it("names the module refusing a slice and never repeats the value", async () => {
    const refusing = defineBrowserModule("refusing").withConfig(
      { process: z.object({ mode: z.string().refine((mode) => mode === "production") }) },
      ({ process }) => process.mode,
    );
    const render = createUi({ document: documentRoot, mount: "root" })
      .withModules([hostServiceFakes(), refusing])
      .withInjectedConfig(() => ({ process: publicAppConfig.process ?? {} }))
      .render();

    const error = await render.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BrowserConfigRefusedError);
    expect(error).toMatchObject({ code: "browser_config_refused", module: "refusing" });
    expect(String(error)).not.toContain('"test"');
  });

  it("keeps builder branches independent", async () => {
    const base = createUi({ document: documentRoot, mount: "root" }).withModules([
      hostServiceFakes(),
      transportModule,
    ]);
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
    const render = createUi({ document: documentRoot, mount: "absent" })
      .withModules([hostServiceFakes()])
      .render();

    await expect(render).rejects.toBeInstanceOf(BrowserMountMissingError);
    await expect(render).rejects.toMatchObject({ code: "browser_mount_missing", mount: "absent" });
  });

  /** @scenario "Rendering with a supply outstanding fails the build" */
  it("names every outstanding supply when render is laundered through instanceof Function", async () => {
    const incomplete = createUi({ document: documentRoot, mount: "root" }).withModules([
      hostServiceFakes(),
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

  /** @scenario "Supplying nothing names everything missing at once" */
  it("names configuration, transport and session in one refusal", async () => {
    const bare = createUi({ document: documentRoot, mount: "root" }).withModules([
      hostServiceFakes(),
      transportModule,
      sessionModule,
      configModule,
    ]);

    expectTypeOf(bare.render).not.toBeFunction();
    const refusal = await renderLaundered(bare);

    expect(refusal).toBeInstanceOf(BrowserSupplyMissingError);
    expect(refusal).toMatchObject({ code: "browser_supply_missing" });
    expect((refusal as BrowserSupplyMissingError).missing.toSorted()).toEqual([
      "injected-config",
      "session",
      "transport",
    ]);
  });

  /** @scenario "Installing a module with its own settings makes a configuration reader required" */
  it("asks for the injected configuration reader once a module with settings is installed", async () => {
    const withoutSettings = createUi({ document: documentRoot, mount: "root" })
      .withModules([hostServiceFakes(), transportModule])
      .withTransport(browserUiTransport);
    expectTypeOf(withoutSettings.render).toBeFunction();
    await expect(withoutSettings.render()).resolves.toMatchObject({ config: {} });

    const withSettings = withoutSettings.withModules([configModule]);

    expectTypeOf(withSettings.render).not.toBeFunction();
    await expect(renderLaundered(withSettings)).resolves.toMatchObject({
      code: "browser_supply_missing",
      missing: ["injected-config"],
    });
  });

  /** @scenario "The chain supplies nothing a browser may not show" */
  it("has no call that takes a secret or an encryption key", () => {
    const chain = createUi({ document: documentRoot, mount: "root" });
    const callsOf = (prototype: object) =>
      Object.getOwnPropertyNames(prototype).filter((name) => name !== "constructor");
    const calls = [
      ...callsOf(Object.getPrototypeOf(chain) as object),
      ...callsOf(UiFacilitiesSupply.prototype),
      ...callsOf(UiShellSupply.prototype),
    ];

    expect(calls).toContain("withTransport");
    expect(calls.filter((name) => /secret|key|encrypt|cipher|credential/i.test(name))).toEqual([]);
    expectTypeOf<UiSupplyName>().toEqualTypeOf<
      | "injected-config"
      | "transport"
      | "session"
      | "feedback"
      | "storage"
      | "document-title"
      | "analytics"
      | "toaster"
      | "graphics-quality"
      | "boot-refusal"
    >();
  });

  it("refuses Object.assign onto render with a TypeError", () => {
    const incomplete = createUi({ document: documentRoot, mount: "root" }).withModules([
      hostServiceFakes(),
      transportModule,
    ]);

    expect(() => Object.assign(incomplete, { render: async () => ({}) })).toThrow(TypeError);
  });
});
