import { setEnvironment } from "@langwatch/ksuid";
import dotenv from "dotenv";

dotenv.config();
setEnvironment(process.env.NODE_ENV ?? "dev");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startApp } = require("./start.js");

void startApp();
