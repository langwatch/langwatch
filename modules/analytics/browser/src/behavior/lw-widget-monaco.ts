/**
 * Gives Monaco's TypeScript worker the widget runtime's real surface: React from the
 * installed @types (lazy text, outside the main bundle), the frame's own globals and
 * modules, and per-widget query row types. Semantic checks start once React is loaded.
 */

import type { Monaco } from "@monaco-editor/react";
import { useEffect } from "react";

import { LW_GLOBAL_DTS } from "../model/dashboard-widget/lw-global-types.ts";
import {
  CSSTYPE_STUB_DTS,
  CSSTYPE_STUB_URI,
  LW_WIDGET_MODULES_DTS,
} from "../model/dashboard-widget/lw-widget-module-types.ts";

const LW_GLOBAL_DTS_URI = "file:///lw-global.d.ts";
const LW_MODULES_DTS_URI = "file:///lw-modules.d.ts";
const LW_ROW_TYPES_URI = "file:///lw-query-rows.d.ts";
const TYPES_DIR = "../../node_modules/@types/";
const REACT_INDEX_URI = "file:///node_modules/@types/react/index.d.ts";

export interface RawLib {
  readonly uri: string;
  readonly text: string;
}

/** Each match is its own lazy chunk; the exports map of @types/* is bypassed by path. */
const REACT_TYPE_FILES = import.meta.glob(
  [
    "../../node_modules/@types/react/{index,global,jsx-runtime,jsx-dev-runtime}.d.ts",
    "../../node_modules/@types/react-dom/{index,client}.d.ts",
  ],
  { query: "?raw", import: "default" },
);

export async function loadReactLibs(): Promise<RawLib[]> {
  return Promise.all(
    Object.entries(REACT_TYPE_FILES).map(async ([path, load]) => ({
      uri: `file:///node_modules/@types/${path.slice(TYPES_DIR.length)}`,
      text: String(await load()),
    })),
  );
}

/** The libs that need no lazy load: the `LW` global, the frame's modules and csstype. */
export const WIDGET_STATIC_LIBS: readonly RawLib[] = [
  { uri: LW_GLOBAL_DTS_URI, text: LW_GLOBAL_DTS },
  { uri: LW_MODULES_DTS_URI, text: LW_WIDGET_MODULES_DTS },
  { uri: CSSTYPE_STUB_URI, text: CSSTYPE_STUB_DTS },
];

interface WidgetTsEnums {
  readonly JsxEmit: { readonly React: number };
  readonly ModuleKind: { readonly ESNext: number };
  readonly ModuleResolutionKind: { readonly NodeJs: number };
  readonly ScriptTarget: { readonly ES2020: number };
}

/** The options the frame's Babel build implies: classic JSX, ESM, React as a UMD global. */
export function widgetCompilerOptions({ enums }: { enums: WidgetTsEnums }) {
  return {
    jsx: enums.JsxEmit.React,
    module: enums.ModuleKind.ESNext,
    moduleResolution: enums.ModuleResolutionKind.NodeJs,
    target: enums.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    allowJs: true,
    allowUmdGlobalAccess: true,
    esModuleInterop: true,
  };
}

let reactLibs: Promise<RawLib[]> | undefined;

async function loadReactLibsOnce(): Promise<RawLib[]> {
  reactLibs ??= loadReactLibs();
  try {
    return await reactLibs;
  } catch (error) {
    reactLibs = undefined;
    throw error;
  }
}

/** Adds each lib unless its uri is already there, so a second pane mount never stacks copies. */
function addLibsOnce({ monaco, libs }: { monaco: Monaco; libs: readonly RawLib[] }): void {
  const defaults = monaco.languages.typescript.typescriptDefaults;
  for (const lib of libs) {
    if (defaults.getExtraLibs()[lib.uri] === undefined) defaults.addExtraLib(lib.text, lib.uri);
  }
}

async function registerReactLibs({ monaco }: { monaco: Monaco }): Promise<void> {
  const defaults = monaco.languages.typescript.typescriptDefaults;
  try {
    addLibsOnce({ monaco, libs: await loadReactLibsOnce() });
    defaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  } catch {
    // ponytail: a failed lazy load leaves semantic checks off, as before; retried on next mount.
  }
}

/** Registers the runtime typings once per Monaco instance; safe to call on every mount. */
export function configureWidgetTypeScript({ monaco }: { monaco: Monaco }): void {
  const typescript = monaco.languages.typescript;
  const defaults = typescript.typescriptDefaults;
  defaults.setCompilerOptions(widgetCompilerOptions({ enums: typescript }));
  const reactRegistered = defaults.getExtraLibs()[REACT_INDEX_URI] !== undefined;
  defaults.setDiagnosticsOptions({
    noSemanticValidation: !reactRegistered,
    noSyntaxValidation: false,
  });
  addLibsOnce({ monaco, libs: WIDGET_STATIC_LIBS });
  if (!reactRegistered) void registerReactLibs({ monaco });
}

/**
 * The row types of the widget being edited. ponytail: the TS defaults are shared by every
 * editor on the page, so two widget editors open at once share the last one mounted.
 */
export function useWidgetRowTypes({
  mounted,
  dts,
}: {
  mounted: { readonly monaco: Monaco } | undefined;
  dts: string;
}): void {
  useEffect(() => {
    if (!mounted) return undefined;
    const lib = mounted.monaco.languages.typescript.typescriptDefaults.addExtraLib(
      dts,
      LW_ROW_TYPES_URI,
    );
    return () => lib.dispose();
  }, [mounted, dts]);
}
