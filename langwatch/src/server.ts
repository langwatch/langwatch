import { setEnvironment } from "@langwatch/ksuid";
import dotenv from "dotenv";
import events from "events";

dotenv.config();
setEnvironment(process.env.ENVIRONMENT ?? "local");

if (process.env.NODE_ENV === "production") {
  process.setMaxListeners(128);
  events.EventEmitter.defaultMaxListeners = 128;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startApp } = require("./start.js");

void startApp();
