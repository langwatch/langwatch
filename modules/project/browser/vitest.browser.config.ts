/**
 * Real-Chromium lane: paint order is something jsdom cannot observe.
 */

import { defineBrowserVitestConfig } from "@langwatch/vitest-config/browser";
import { playwright } from "@vitest/browser-playwright";
import { mergeConfig, type Plugin } from "vitest/config";

const diagnose: Plugin = {
  name: "diag-failed-requests",
  configureServer(server) {
    let total = 0;
    let inflight = 0;
    let peak = 0;
    const started = Date.now();
    setInterval(() => {
      process.stderr.write(`[diag] t=${Date.now() - started}ms total=${total} inflight=${inflight} peak=${peak}\n`);
    }, 2000).unref();
    server.middlewares.use((req, res, next) => {
      total += 1;
      inflight += 1;
      peak = Math.max(peak, inflight);
      const t0 = Date.now();
      res.on("close", () => {
        inflight -= 1;
        const ms = Date.now() - t0;
        if (!res.writableFinished) process.stderr.write(`[diag] aborted after ${ms}ms ${req.url}\n`);
        else if (ms > 3000) process.stderr.write(`[diag] slow ${ms}ms ${req.url}\n`);
      });
      res.on("finish", () => {
        if (res.statusCode < 400) return;
        const url = req.url ?? "";
        process.stderr.write(`[diag] ${res.statusCode} ${url}\n`);
        server
          .transformRequest(url.replace(/[?&]import\b/, ""))
          .then((r) => process.stderr.write(`[diag] retransform ok ${url} ${r ? r.code.length : "null"}\n`))
          .catch((e: unknown) =>
            process.stderr.write(`[diag] retransform error ${url}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`),
          );
      });
      next();
    });
    const origError = server.config.logger.error;
    server.config.logger.error = (msg, opts) => {
      process.stderr.write(`[diag] logger.error ${msg} ${opts?.error?.stack ?? ""}\n`);
      origError(msg, opts);
    };
  },
};

process.env.DEBUG = "pw:browser";
const base = defineBrowserVitestConfig();
export default mergeConfig(base, {
  plugins: [diagnose],
  test: {
    browser: {
      provider: playwright({ launchOptions: { args: ["--enable-logging=stderr", "--v=0"] } }),
    },
  },
});
