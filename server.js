require("dotenv").config();

process.env.NEXTJS_DIST_DIR = ".next-sass";
process.env.DEPENDENCY_INJECTION = `${__dirname}/src/injection.ts`;
process.env.EXTRA_INCLUDE = `${__dirname}/src`;

const { startApp } = require("./langwatch/langwatch/src/start");

startApp("./langwatch/langwatch");
