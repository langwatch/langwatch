import { run } from "./main.ts";

/** The vision key comes from the environment haven sets; never printed, .env never read. */
const { ANTHROPIC_API_KEY = "", ANTHROPIC_BASE_URL } = process.env;
const code = await run({
  argv: process.argv.slice(2),
  key: { apiKey: ANTHROPIC_API_KEY, baseUrl: ANTHROPIC_BASE_URL },
});
process.stdout.write("", () => process.exit(code));
