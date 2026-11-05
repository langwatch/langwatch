/**
 * Real-Chromium lane: paint order is something jsdom cannot observe.
 */

import { defineBrowserVitestConfig } from "@langwatch/vitest-config/browser";
import { mergeConfig, type Plugin } from "vitest/config";

const diagnose: Plugin = {
  name: "diag-failed-requests",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
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

export default mergeConfig(defineBrowserVitestConfig(), { plugins: [diagnose] });
