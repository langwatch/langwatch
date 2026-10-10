/**
 * Runs the frame document's own scripts and fails when a global, built-in
 * module or charts export the runtime provides has no declaration for Monaco.
 * @see specs/analytics-widget-editor.feature
 */

import { buildChartFrameDocument } from "@langwatch/analytics-contract/chart-frame-document";
import { CHART_FRAME_GLOBAL_EXPORTS } from "@langwatch/analytics-contract/chart-frame-import-map";
import { describe, expect, it } from "vitest";

import { LW_GLOBAL_DTS } from "../lw-global-types.ts";
import { LW_WIDGET_MODULES_DTS } from "../lw-widget-module-types.ts";

const INLINE_SCRIPTS = [...buildChartFrameDocument().matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (match) => match[1] ?? "",
);

function scriptContaining({ marker }: { marker: string }): string {
  const script = INLINE_SCRIPTS.find((candidate) => candidate.includes(marker));
  if (script === undefined) throw new Error(`no frame script contains ${marker}`);
  return script;
}

function declaredMembers({ dts, declaration }: { dts: string; declaration: string }): string[] {
  const start = dts.indexOf(declaration);
  const end = dts.indexOf("\n}", start);
  return [...dts.slice(start, end).matchAll(/^ {2}(?:readonly )?(\w+)[?:]/gm)].map(
    (m) => m[1] ?? "",
  );
}

describe("the declarations Monaco reads for the widget runtime", () => {
  /** @scenario "Every name the frame provides is declared for the editor" */
  it("declares every member the shim puts on LW", () => {
    const frame: { addEventListener: () => void; React: object; parent: object; LW?: object } = {
      addEventListener: () => undefined,
      React: {},
      parent: {},
    };
    const shim = scriptContaining({ marker: "var LW = {" });
    // The shim ships as a string; evaluating it is the test.
    // oxlint-disable-next-line no-implied-eval
    new Function("window", "console", "setInterval", shim)(frame, console, () => 0);
    const provided = Object.keys(frame.LW ?? {}).toSorted();
    const declared = declaredMembers({ dts: LW_GLOBAL_DTS, declaration: "interface LwApi" });

    expect(provided.length).toBeGreaterThan(5);
    expect(provided.filter((name) => !declared.includes(name))).toEqual([]);
  });

  it("declares every built-in module the frame resolves", () => {
    const runtime = scriptContaining({ marker: "var BUILTINS" });
    const builtins: string[] = JSON.parse(/var BUILTINS = (\[.*?\]);/.exec(runtime)?.[1] ?? "[]");
    const reactTypes = [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
    ];
    const undeclared = builtins.filter(
      (name) =>
        !reactTypes.includes(name) && !LW_WIDGET_MODULES_DTS.includes(`declare module "${name}"`),
    );

    expect(builtins).toContain("@langwatch/charts");
    expect(undeclared).toEqual([]);
  });

  it("declares every UMD global the frame loads", () => {
    const globals = Object.keys(CHART_FRAME_GLOBAL_EXPORTS);

    expect(globals).toEqual(expect.arrayContaining(["React", "Recharts", "LWCharts"]));
    const undeclared = globals.filter(
      (name) =>
        !["React", "ReactDOM"].includes(name) &&
        !LW_WIDGET_MODULES_DTS.includes(`declare const ${name}:`),
    );
    expect(undeclared).toEqual([]);
  });

  it("declares every export of the charts library", () => {
    const script = scriptContaining({ marker: "var LWCharts=" });
    // oxlint-disable-next-line no-implied-eval
    const exported = Object.keys(new Function("window", `${script}\nreturn LWCharts;`)({}));

    expect(exported.length).toBeGreaterThan(5);
    expect(
      exported.filter(
        (name) =>
          !LW_WIDGET_MODULES_DTS.includes(`export const ${name}:`) &&
          !LW_WIDGET_MODULES_DTS.includes(`export function ${name}(`),
      ),
    ).toEqual([]);
  });
});
