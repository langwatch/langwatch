import { spawn, type ChildProcess } from "child_process";
import net from "net";
import path from "path";
import type { Plugin } from "vite";

/**
 * `/design-system` frames the design system's Storybook on its own origin,
 * because Storybook emits root-absolute module addresses that collide with
 * this application's Vite. It starts on the first visit, never at boot.
 */

const ROUTE = "/design-system";

export function designSystemStorybook(options: { appPort: number }): Plugin {
  const port = Number(process.env.LANGWATCH_STORYBOOK_PORT ?? options.appPort + 5);
  const storybookUrl = `http://localhost:${port}`;
  let child: ChildProcess | undefined;
  let starting = false;

  async function ensureStarted(): Promise<void> {
    if (child ?? starting) return;
    if (await isListening(port)) return;
    starting = true;
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    child = spawn(
      "pnpm",
      ["-s", "--filter", "@langwatch/design-system", "storybook", "--port", String(port), "--ci"],
      { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"], env: process.env },
    );
    child.on("exit", () => {
      child = undefined;
      starting = false;
    });
  }

  return {
    name: "langwatch-design-system-storybook",
    apply: "serve",
    configureServer(server) {
      if (process.env.LANGWATCH_SKIP_STORYBOOK === "1") {
        server.config.logger.info(`  ✓ storybook: skipped (LANGWATCH_SKIP_STORYBOOK=1)`);
        return;
      }
      server.config.logger.info(`  ✓ storybook: ${ROUTE} (starts on first visit, :${port})`);

      server.middlewares.use(ROUTE, (req, res, next) => {
        const url = req.url ?? "/";
        if (url.startsWith("/status")) {
          void ensureStarted();
          void isListening(port).then((ready) => {
            res.setHeader("content-type", "application/json");
            res.setHeader("cache-control", "no-store");
            res.end(JSON.stringify({ ready, url: storybookUrl }));
          });
          return;
        }
        const isRouteItself = url === "/" || url.startsWith("/?") || url.startsWith("/#");
        if (!isRouteItself) return next();
        void ensureStarted();
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(shell({ storybookUrl }));
      });

      server.httpServer?.on("close", () => child?.kill());
    },
  };
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (answer: boolean) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(400);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
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
