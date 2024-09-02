const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const path = require("path");
let studioSocket = require("../build-websocket/socketServer");

const reloadStudioSocket = () => {
  delete require.cache[require.resolve("../build-websocket/socketServer")];
  studioSocket = require("../build-websocket/socketServer");
  console.log("Reloaded studioSocket module");
};

if (process.env.NODE_ENV !== "production") {
  const watch = require("watch");
  watch.createMonitor(
    path.join(__dirname, "../build-websocket"),
    { interval: 1 },
    function (monitor) {
      monitor.on("changed", function () {
        reloadStudioSocket();
      });
    }
  );
}

module.exports.startApp = async (dir = path.dirname(__dirname)) => {
  const dev = process.env.NODE_ENV !== "production";
  const hostname = "0.0.0.0";
  const port = parseInt(process.env.PORT ?? "3000");
  // when using middleware `hostname` and `port` must be provided below
  const app = next({ dev, hostname, port, dir });
  const handle = app.getRequestHandler();
  const upgradeHandler = app.getUpgradeHandler();

  await app.prepare();

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const server = createServer(async (req, res) => {
    try {
      // Be sure to pass `true` as the second argument to `url.parse`.
      // This tells it to parse the query portion of the URL.
      const parsedUrl = parse(req.url ?? "", true);

      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const upgradeListener = (defaultHandler) => (req, socket, head) => {
    const parsedUrl = parse(req.url ?? "", true);

    // Pass hot module reloading requests to Next.js
    if (parsedUrl.pathname === "/_next/webpack-hmr") {
      void defaultHandler(req, socket, head);
    } else if (parsedUrl.pathname?.startsWith("/api/studio/ws")) {
      void studioSocket.handleUpgrade(req, socket, head, parsedUrl);
    } else {
      socket.destroy();
    }
  };

  const initialHandler = upgradeListener(upgradeHandler);
  server.on("upgrade", initialHandler);

  // Workaround because apparently next.js calls .on("upgrade", ...) internally,
  // overwriting the initialHandler, we need to re - attach it while keeping hmr working
  const originalOn = server.on.bind(server);
  server.on = (event, handler) => {
    if (event === "upgrade") {
      server.off("upgrade", initialHandler);
      return originalOn(event, upgradeListener(handler));
    }
    return originalOn(event, handler);
  };

  server.once("error", (err) => {
    console.error(err);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(
      `\n🎉 LangWatch is ready on http://${
        process.env.NODE_ENV === "production" ? hostname : "localhost"
      }:${port}\n`
    );
  });
};
