const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const path = require("path");

module.exports.startApp = async (dir = path.dirname(__dirname)) => {
  const dev = process.env.NODE_ENV !== "production";
  const hostname = "localhost";
  const port = 3000;
  // when using middleware `hostname` and `port` must be provided below
  const app = next({ dev, hostname, port, dir });
  const handle = app.getRequestHandler();

  await app.prepare();

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  createServer(async (req, res) => {
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
  })
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
};
