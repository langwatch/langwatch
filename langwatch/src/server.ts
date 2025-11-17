import dotenv from "dotenv";
import { setEnvironment } from "@langwatch/ksuid";

dotenv.config();
setEnvironment(process.env.NODE_ENV ?? "dev");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startApp } = require("./start.js");

void startApp();
