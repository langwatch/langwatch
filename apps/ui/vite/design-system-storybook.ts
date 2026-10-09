import type { IncomingMessage, ServerResponse } from "http";
import path from "path";

import type { Plugin } from "vite";

import {
  DEV_TOOLS_IDLE_ENV,
  devToolPort,
  idleBoundMs,
  startDormantTool,
  type DormantTool,
} from "./dormant-dev-tool";

/**
 * `/design-system` frames the design system's Storybook on its own origin,
 * because Storybook emits root-absolute module addresses that collide with
 * this application's Vite. It starts on the first visit and stops once idle.
 */

const ROUTE = "/design-system";

export function designSystemStorybook(options: { appPort: number }): Plugin {
  return {
    name: "langwatch-design-system-storybook",
    apply: "serve",
    async configureServer(server) {
      const { logger } = server.config;
      if (process.env.LANGWATCH_SKIP_STORYBOOK === "1") {
        logger.info(`  ✓ storybook: skipped (LANGWATCH_SKIP_STORYBOOK=1)`);
        return;
      }
      const port = await devToolPort({
        explicit: process.env.LANGWATCH_STORYBOOK_PORT,
        appPort: options.appPort,
        offset: 5,
        env: process.env,
      });
      const storybookUrl = `http://127.0.0.1:${port}`;
      const tool = startDormantTool({
        name: "storybook",
        port,
        cwd: path.resolve(import.meta.dirname, "../../.."),
        command: ({ port: inner }) => ({
          file: "pnpm",
          args: [
            "-s",
            "--filter",
            "@langwatch/design-system",
            "storybook",
            "--port",
            String(inner),
            "--ci",
          ],
        }),
        idleAfterMs: idleBoundMs({ value: process.env[DEV_TOOLS_IDLE_ENV] }),
        log: (line) => logger.info(`  ${line}`),
      });
      logger.info(`  ✓ storybook: ${ROUTE} and ${storybookUrl} (starts on first visit)`);
      server.middlewares.use(ROUTE, (req, res, next) =>
        serveRoute({ req, res, next, tool, storybookUrl }),
      );
      server.httpServer?.on("close", () => tool.close());
    },
  };
}

/** The page itself wakes Storybook; its status poll only reports, so an open tab never
 * restarts it. */
function serveRoute({
  req,
  res,
  next,
  tool,
  storybookUrl,
}: {
  req: IncomingMessage;
  res: ServerResponse;
  next: () => void;
  tool: DormantTool;
  storybookUrl: string;
}): void {
  const url = req.url ?? "/";
  res.setHeader("cache-control", "no-store");
  if (url.startsWith("/status")) {
    const state = tool.state();
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ ready: state === "ready" || state === "external", url: storybookUrl }),
    );
    return;
  }
  const isRouteItself = url === "/" || url.startsWith("/?") || url.startsWith("/#");
  if (!isRouteItself) return next();
  if (req.method === "GET") tool.wake();
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(shell({ storybookUrl }));
}

/**
 * The shell: full viewport, the viewer's colour scheme, and the frame swapped
 * in once Storybook answers. Query and hash are handed through, so a story
 * address still opens the story it names.
 */
function shell({ storybookUrl }: { storybookUrl: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LangWatch design system</title>
    <style>
      :root { color-scheme: light dark; }
      html, body { height: 100%; margin: 0; }
      body {
        background: #fff; color: #1d293d;
        font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #18181b; color: #f1f5f9; }
      }
      iframe { display: block; width: 100%; height: 100%; border: 0; }
      #waiting {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 10px; height: 100%; text-align: center; padding: 24px;
      }
      #waiting p { margin: 0; opacity: 0.7; }
      #waiting a { color: inherit; }
    </style>
  </head>
  <body>
    <div id="waiting">
      <strong>Starting the component workshop</strong>
      <p>Storybook is building the design system. This takes a few seconds the first time.</p>
      <p><a href="${storybookUrl}">${storybookUrl}</a></p>
    </div>
    <script>
      (function () {
        var target = ${JSON.stringify(storybookUrl)} + location.search + location.hash;
        function show() {
          var frame = document.createElement("iframe");
          frame.src = target;
          frame.title = "LangWatch design system";
          document.body.replaceChildren(frame);
        }
        function poll() {
          fetch("${ROUTE}/status", { cache: "no-store" })
            .then(function (response) { return response.json(); })
            .then(function (status) { status.ready ? show() : setTimeout(poll, 1000); })
            .catch(function () { setTimeout(poll, 1000); });
        }
        poll();
      })();
    </script>
  </body>
</html>
`;
}
