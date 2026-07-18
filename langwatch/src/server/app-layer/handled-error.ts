// The HandledError contract lives in the shared `@langwatch/handled-error`
// package (packages/handled-error) so the app, MCP server, CLI and SDKs all
// speak the same shape. This shim wires the app's Grafana trace-link builder
// into the package and re-exports everything, so existing
// `~/server/app-layer/handled-error` imports keep working unchanged.
import { setTraceUrlProvider } from "@langwatch/handled-error";

import { grafanaTraceUrlFromEnv } from "~/utils/grafanaLinks";

setTraceUrlProvider(grafanaTraceUrlFromEnv);

export * from "@langwatch/handled-error";
