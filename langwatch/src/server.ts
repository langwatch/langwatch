import { setEnvironment } from "@langwatch/ksuid";
import dotenv from "dotenv";

dotenv.config();
setEnvironment(process.env.ENVIRONMENT ?? "local");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startApp } = require("./start.js");

void startApp();
