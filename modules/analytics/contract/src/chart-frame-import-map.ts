/**
 * The frame's import map, as data: each built-in specifier points at a `data:`
 * module re-exporting a UMD global, so every importer shares one instance.
 * Static, so the document can carry it ahead of any module script.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

/**
 * The named exports of each global, recorded from the pinned UMD builds
 * (react 18.3.1, react-dom 18.3.1, recharts 2.15.4) and the bundled charts
 * library. A module's exports are fixed at parse time, so they are listed.
 */
export const CHART_FRAME_GLOBAL_EXPORTS = {
  React: [
    "Children",
    "Component",
    "Fragment",
    "Profiler",
    "PureComponent",
    "StrictMode",
    "Suspense",
    "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
    "act",
    "cloneElement",
    "createContext",
    "createElement",
    "createFactory",
    "createRef",
    "forwardRef",
    "isValidElement",
    "lazy",
    "memo",
    "startTransition",
    "unstable_act",
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
    "version",
  ],
  ReactDOM: [
    "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
    "createPortal",
    "createRoot",
    "findDOMNode",
    "flushSync",
    "hydrate",
    "hydrateRoot",
    "render",
    "unmountComponentAtNode",
    "unstable_batchedUpdates",
    "unstable_renderSubtreeIntoContainer",
    "version",
  ],
  Recharts: [
    "Area",
    "AreaChart",
    "Bar",
    "BarChart",
    "Brush",
    "CartesianAxis",
    "CartesianGrid",
    "Cell",
    "ComposedChart",
    "Cross",
    "Curve",
    "Customized",
    "DefaultLegendContent",
    "DefaultTooltipContent",
    "Dot",
    "ErrorBar",
    "Funnel",
    "FunnelChart",
    "Global",
    "Label",
    "LabelList",
    "Layer",
    "Legend",
    "Line",
    "LineChart",
    "Pie",
    "PieChart",
    "PolarAngleAxis",
    "PolarGrid",
    "PolarRadiusAxis",
    "Polygon",
    "Radar",
    "RadarChart",
    "RadialBar",
    "RadialBarChart",
    "Rectangle",
    "ReferenceArea",
    "ReferenceDot",
    "ReferenceLine",
    "ResponsiveContainer",
    "Sankey",
    "Scatter",
    "ScatterChart",
    "Sector",
    "SunburstChart",
    "Surface",
    "Symbols",
    "Text",
    "Tooltip",
    "Trapezoid",
    "Treemap",
    "XAxis",
    "YAxis",
    "ZAxis",
  ],
  LWCharts: [
    "AreaTimeseries",
    "Donut",
    "GroupedBars",
    "Heatmap",
    "Leaderboard",
    "LwqlChart",
    "MetricStat",
    "ProjectionBars",
    "Sparkline",
    "StackedBars",
    "interpolateColor",
    "parseHexRgb",
  ],
} as const satisfies Record<string, readonly string[]>;

type ChartFrameGlobal = keyof typeof CHART_FRAME_GLOBAL_EXPORTS;

const SPECIFIER_GLOBALS: Readonly<Record<string, ChartFrameGlobal>> = {
  react: "React",
  "react-dom": "ReactDOM",
  "react-dom/client": "ReactDOM",
  recharts: "Recharts",
  "@langwatch/charts": "LWCharts",
};

function toDataModuleUrl(source: string): string {
  return "data:text/javascript;charset=utf-8," + encodeURIComponent(source);
}

/** The module one global is served as: itself as default, its members by name. */
export function buildGlobalModuleSource(globalName: ChartFrameGlobal): string {
  const names = CHART_FRAME_GLOBAL_EXPORTS[globalName].join(", ");
  return `const m = window.${globalName};\nexport default m;\nexport const { ${names} } = m;`;
}

/**
 * The "react/jsx-runtime" the import map serves, so a package built with the
 * automatic runtime shares the frame's React. `props.children` passes through
 * untouched: spreading it would turn an empty array into undefined.
 */
export function buildJsxRuntimeModuleSource(globalName: string): string {
  return (
    `const React = window.${globalName};\n` +
    "export const Fragment = React.Fragment;\n" +
    "export function jsx(type, props, key) {\n" +
    "  var p = props || {};\n" +
    "  return key === undefined ? React.createElement(type, p) : React.createElement(type, Object.assign({}, p, { key: key }));\n" +
    "}\n" +
    "export function jsxs(type, props, key) {\n" +
    "  return jsx(type, props, key);\n" +
    "}\n" +
    "export function jsxDEV(type, props, key) {\n" +
    "  return jsx(type, props, key);\n" +
    "}"
  );
}

/** Specifier to module URL, for every built-in the frame satisfies itself. */
export function buildChartFrameImportMap(): { imports: Record<string, string> } {
  const imports: Record<string, string> = {};
  for (const [specifier, globalName] of Object.entries(SPECIFIER_GLOBALS)) {
    imports[specifier] = toDataModuleUrl(buildGlobalModuleSource(globalName));
  }
  const jsxRuntime = toDataModuleUrl(buildJsxRuntimeModuleSource("React"));
  imports["react/jsx-runtime"] = jsxRuntime;
  imports["react/jsx-dev-runtime"] = jsxRuntime;
  return { imports };
}
