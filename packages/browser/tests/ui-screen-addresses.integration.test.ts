/**
 * Two installed modules whose screens declare one address are refused at boot, before the
 * first render, naming both modules and the address. specs/ui/declared-browser-supply.feature.
 */

import { describe, expect, it } from "vitest";

import { BrowserPageClaimedTwiceError, createUi, defineBrowserModule, hostServiceFakes } from "../src/index.ts";
import { browserUiTransport, documentRoot } from "./ui-supply.fixtures.ts";

const page = { default: () => null };
const load = () => Promise.resolve(page);

const traces = defineBrowserModule("trace").withScreens({
  "trace:list": { path: "/:project/traces", within: "project", load },
});
const rival = defineBrowserModule("rival").withScreens({
  "rival:list": { path: "/:projectSlug/traces/", within: "project", load },
});
const runs = defineBrowserModule("run").withScreens({
  "run:list": { path: "/:project/runs", within: "project", load },
});

describe("screen addresses at boot", () => {
  describe("given two installed modules whose screens declare the same path", () => {
    /** @scenario "Two modules claiming one address are refused by name" */
    it("refuses before the first render, naming both modules and the address", async () => {
      const refusal = await createUi({ document: documentRoot, mount: "root" })
        .withModules([hostServiceFakes(), traces, rival])
        .withTransport(browserUiTransport)
        .render()
        .catch((caught: unknown) => caught);

      expect(refusal).toBeInstanceOf(BrowserPageClaimedTwiceError);
      expect(refusal).toMatchObject({ code: "browser_page_claimed_twice" });
      expect((refusal as BrowserPageClaimedTwiceError).refusals).toEqual([
        'Address "/:projectSlug/traces/" is declared by both "trace" and "rival".',
      ]);
    });
  });

  describe("given installed modules whose screens declare different paths", () => {
    it("boots", async () => {
      const booted = createUi({ document: documentRoot, mount: "root" })
        .withModules([hostServiceFakes(), traces, runs])
        .withTransport(browserUiTransport)
        .render();

      await expect(booted).resolves.toMatchObject({ config: {} });
    });
  });
});
