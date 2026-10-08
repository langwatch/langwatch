import path from "path";

import type { Plugin } from "vite";

import { DEV_TOOLS_IDLE_ENV, idleBoundMs, startDormantTool } from "./dormant-dev-tool";

/**
 * The mail preview studio (`@langwatch/mail`), held dormant on its own port by
 * the app's dev server: the first visit starts it, idleness stops it. Haven
 * routes `mail-room.<slug>` to the port it hands in as LANGWATCH_MAIL_PREVIEW_PORT.
 */
export function mailPreview(options: { appPort: number }): Plugin {
  const port = Number(process.env.LANGWATCH_MAIL_PREVIEW_PORT ?? options.appPort + 6);

  return {
    name: "langwatch-mail-preview",
    apply: "serve",
    configureServer(server) {
      const { logger } = server.config;
      if (process.env.LANGWATCH_SKIP_MAIL_PREVIEW === "1") return;
      const tool = startDormantTool({
        name: "mail preview",
        port,
        cwd: path.resolve(import.meta.dirname, "../../.."),
        command: ({ port: inner }) => ({
          file: "pnpm",
          args: [
            "--silent",
            "--filter",
            "@langwatch/mail",
            "dev",
            "--host",
            "127.0.0.1",
            "--port",
            String(inner),
            "--strictPort",
          ],
        }),
        idleAfterMs: idleBoundMs({ value: process.env[DEV_TOOLS_IDLE_ENV] }),
        log: (line) => logger.info(`  ${line}`),
      });
      logger.info(`  ✓ mail preview: http://127.0.0.1:${port} (starts on first visit)`);
      server.httpServer?.on("close", () => tool.close());
    },
  };
}
