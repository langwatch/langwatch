/**
 * Runs Monaco's own bundled TypeScript services over widget source with the
 * exact libs and compiler options the editor registers, so a widget that runs
 * in the frame must show no diagnostics and a misuse must show one.
 * @see specs/analytics-widget-editor.feature
 */

import { libFileMap } from "monaco-editor/esm/vs/language/typescript/lib/lib.js";
import { typescript as ts } from "monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js";
import { describe, expect, it } from "vitest";

import { lwQueryRowTypesDts } from "../../model/dashboard-widget/lw-query-row-types.ts";
import { STARTER_WIDGET_CODE } from "../../model/dashboard-widget/presets.ts";
import { loadReactLibs, WIDGET_STATIC_LIBS, widgetCompilerOptions } from "../lw-widget-monaco.ts";

const WIDGET_URI = "file:///widget.tsx";
const STARTER_COLUMNS = [
  { name: "bucket", type: "DateTime" },
  { name: "events", type: "UInt64" },
];

async function diagnose({
  code,
  columns = [],
}: {
  code: string;
  columns?: readonly { name: string; type: string }[];
}): Promise<string[]> {
  const files = new Map<string, string>();
  for (const lib of [...(await loadReactLibs()), ...WIDGET_STATIC_LIBS]) {
    files.set(lib.uri, lib.text);
  }
  files.set(
    "file:///lw-query-rows.d.ts",
    lwQueryRowTypesDts({ queries: [{ name: "main", columns }] }),
  );
  files.set(WIDGET_URI, code);
  const options = widgetCompilerOptions({ enums: ts });
  const service = ts.createLanguageService({
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const text = files.get(name) ?? libFileMap[name.replace(/^.*\//, "")];
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => "file:///",
    getDefaultLibFileName: () => "lib.es2020.full.d.ts",
    fileExists: (name) => files.has(name) || libFileMap[name.replace(/^.*\//, "")] !== undefined,
    readFile: (name) => files.get(name) ?? libFileMap[name.replace(/^.*\//, "")],
  });
  return [
    ...service.getSyntacticDiagnostics(WIDGET_URI),
    ...service.getSemanticDiagnostics(WIDGET_URI),
  ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("the widget editor's TypeScript worker configuration", () => {
  describe("given the starter widget, which runs in the frame today", () => {
    /** @scenario "A widget that runs in the frame shows no editor errors" */
    it("reports no diagnostics", async () => {
      expect(await diagnose({ code: STARTER_WIDGET_CODE, columns: STARTER_COLUMNS })).toEqual([]);
    });

    it("reports no diagnostics before any query has run", async () => {
      expect(await diagnose({ code: STARTER_WIDGET_CODE })).toEqual([]);
    });
  });

  describe("given a widget using React hooks and the charts library", () => {
    const code = `import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LwqlChart, MetricStat } from "@langwatch/charts";
import dayjs from "dayjs";

export default function Widget() {
  const [count] = useState(0);
  const theme = LW.useDashboardContext().theme;
  return <div style={{ height: "100%" }}><MetricStat value={count} label={theme} /><LwqlChart data={[]} /></div>;
}
`;

    /** @scenario "A widget that runs in the frame shows no editor errors" */
    it("reports no diagnostics, and esm.sh packages stay untyped rather than erroring", async () => {
      expect(await diagnose({ code })).toEqual([]);
    });
  });

  describe("given a misuse of the typed surface", () => {
    /** @scenario "A type error in widget code is reported" */
    it("reports a React hook misuse", async () => {
      const code = `import { useState } from "react";
export default function Widget() {
  const [count] = useState(0);
  return <div>{count.nope()}</div>;
}
`;
      expect(await diagnose({ code })).toEqual([expect.stringContaining("'nope'")]);
    });

    it("reports an unknown LW member", async () => {
      expect(await diagnose({ code: `export default () => LW.nope();` })).toEqual([
        expect.stringContaining("'nope'"),
      ]);
    });
  });

  describe("given a query whose columns the last run returned", () => {
    const widget = (body: string) => `export default function Widget() {
  const { data } = LW.useChartQuery("main", {});
  const row = data![0]!;
  return <div>{${body}}</div>;
}
`;

    /** @scenario "Query result rows are typed from the last run's columns" */
    it("accepts a column used as its ClickHouse type", async () => {
      const diagnostics = await diagnose({
        code: widget("row.bucket.slice(5) + String(row.events)"),
        columns: STARTER_COLUMNS,
      });
      expect(diagnostics).toEqual([]);
    });

    it("rejects a column used as the wrong type", async () => {
      const diagnostics = await diagnose({
        code: widget("row.bucket.toFixed(2)"),
        columns: STARTER_COLUMNS,
      });
      expect(diagnostics).toEqual([expect.stringContaining("'toFixed'")]);
    });

    /** @scenario "A query that has not run yields unknown rows" */
    it("types a column as unknown when no run exists", async () => {
      expect(await diagnose({ code: widget("row.bucket.slice(5)") })).toEqual([
        expect.stringContaining("'slice'"),
      ]);
    });
  });
});
