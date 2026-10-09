import { run } from "./main.ts";

/** The judge's key comes from the environment haven sets; never printed, .env never read. */
const { ANTHROPIC_API_KEY = "", ANTHROPIC_BASE_URL } = process.env;
run({
  argv: process.argv.slice(2),
  key: { apiKey: ANTHROPIC_API_KEY, baseUrl: ANTHROPIC_BASE_URL },
});
