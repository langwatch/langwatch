/**
 * @vitest-environment jsdom
 * The composed drawer registry over the address bar: each name a module declared mounts
 * its own drawer when it is the address's `drawer.open`.
 */

import { CurrentDrawer } from "@langwatch/browser-host/drawer";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { defineBrowserModule } from "../src/index.ts";
import { installedModuleDrawers } from "../src/ui-module-drawers.ts";

const drawerShowing = (text: string) => ({ default: () => <p>{text}</p> });

const trace = defineBrowserModule("trace").withDrawers({
  traceDetails: { load: () => Promise.resolve(drawerShowing("trace details")) },
  spanDetails: { load: () => Promise.resolve(drawerShowing("span details")) },
});

const evaluator = defineBrowserModule("evaluator").withDrawers({
  evaluatorEditor: { load: () => Promise.resolve(drawerShowing("evaluator editor")) },
});

const annotation = defineBrowserModule("annotation").withScreens({
  "pages/annotations": { path: "/annotations" },
});

const registry = installedModuleDrawers([trace, evaluator, annotation]);

const mounted: Readonly<Record<string, string>> = {
  traceDetails: "trace details",
  spanDetails: "span details",
  evaluatorEditor: "evaluator editor",
};

afterEach(cleanup);

describe("the composed drawer registry", () => {
  /** @scenario "Every declared drawer opens from its own address" */
  it.each(Object.keys(registry))("mounts %s from its own address", async (name) => {
    renderWithDesignSystem(
      <MemoryRouter initialEntries={[`/project?drawer.open=${name}`]}>
        <Routes>
          <Route path="*" element={<CurrentDrawer drawers={registry} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(mounted[name] ?? name)).toBeTruthy();
  });

  it("carries every declared drawer and nothing else", () => {
    expect(Object.keys(registry).toSorted()).toEqual(Object.keys(mounted).toSorted());
  });
});
