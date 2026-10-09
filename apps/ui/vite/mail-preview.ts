import path from "path";

import { createServer, type Plugin } from "vite";

import {
  DEV_TOOLS_IDLE_ENV,
  idleBoundMs,
  startDormantTool,
  type DormantToolOptions,
  type HostedTool,
} from "./dormant-dev-tool";

/**
 * The mail preview studio (`@langwatch/mail`), held dormant on its own port by
 * the app's dev server: the first visit starts it, idleness stops it. Haven
 * routes `mail-room.<slug>` to the port it hands in as LANGWATCH_MAIL_PREVIEW_PORT.
 */

/** "1" runs the studio as its own process again, should hosting it here misbehave. */
export const MAIL_PREVIEW_SPAWN_ENV = "LANGWATCH_MAIL_PREVIEW_SPAWN";
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const PREVIEW_CONFIG = path.join(REPO_ROOT, "packages/mail/preview/vite.config.ts");

export function mailPreview(options: { appPort: number }): Plugin {
  const port = Number(process.env.LANGWATCH_MAIL_PREVIEW_PORT ?? options.appPort + 6);

  return {
    name: "langwatch-mail-preview",
    apply: "serve",
    configureServer(server) {
      const { logger } = server.config;
      if (process.env.LANGWATCH_SKIP_MAIL_PREVIEW === "1") return;
      const tool = startDormantTool(
        mailPreviewTool({ port, env: process.env, log: (line) => logger.info(`  ${line}`) }),
      );
      logger.info(`  ✓ mail preview: http://127.0.0.1:${port} (starts on first visit)`);
      server.httpServer?.on("close", () => tool.close());
    },
  };
}

/** Hosted in this process by default, so a dev stack runs one JS process for the UI side. */
export function mailPreviewTool({
  port,
  env,
  log,
}: {
  port: number;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}): DormantToolOptions {
  const base = {
    name: "mail preview",
    port,
    log,
    idleAfterMs: idleBoundMs({ value: env[DEV_TOOLS_IDLE_ENV] }),
  };
  if (env[MAIL_PREVIEW_SPAWN_ENV] !== "1") return { ...base, start: hostPreview };
  return {
    ...base,
    cwd: REPO_ROOT,
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
  };
}

/** The studio's own Vite config, served by a second Vite server inside this process. */
async function hostPreview({ port }: { port: number }): Promise<HostedTool> {
  const server = await createServer({
    configFile: PREVIEW_CONFIG,
    clearScreen: false,
    logLevel: "warn",
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  try {
    await server.listen();
  } catch (error) {
    await server.close();
    throw error;
  }
  return server;
}
