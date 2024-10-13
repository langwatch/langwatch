import dotenv from "dotenv";

dotenv.config();

process.env.NEXTJS_DIST_DIR = process.env.NEXTJS_DIST_DIR || ".next-saas";
process.env.DEPENDENCY_INJECTION_DIR = `${__dirname}/src/injection/`;
process.env.EXTRA_INCLUDE = `${__dirname}/src`;

if (process.env.NODE_ENV === "production") {
  process.setMaxListeners(128);
  require("events").EventEmitter.defaultMaxListeners = 128;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startApp } = require("./langwatch/langwatch/src/start.js");

startApp("./langwatch/langwatch");
