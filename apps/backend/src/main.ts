import "@langwatch/time/polyfill";
import { startApi } from "@langwatch/platform-api";
import { runBackend } from "@langwatch/process/backend-host";
import { startWorker } from "@langwatch/worker";

/** The api and the worker in one Node process, as `npx @langwatch/server` runs them (ADR-168). */
await runBackend({ startApi, startWorker });
