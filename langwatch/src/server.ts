import dotenv from "dotenv";

dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startApp } = require("./start.js");

void startApp();
