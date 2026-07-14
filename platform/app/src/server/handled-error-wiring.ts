// Wires the app's Grafana trace-link builder into the shared
// `@langwatch/handled-error` package — the package itself is env-agnostic so
// the MCP server / CLI / SDKs can consume it. Imported for side effects by
// the server and worker entry points; registration only stores the function,
// so import order vs. dotenv does not matter (env is read per serialize()).
import { setTraceUrlProvider } from "@langwatch/handled-error";

import { grafanaTraceUrlFromEnv } from "~/utils/grafanaLinks";

setTraceUrlProvider(grafanaTraceUrlFromEnv);
