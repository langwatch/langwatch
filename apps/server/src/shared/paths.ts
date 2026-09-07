import { homedir } from "node:os";
import { join } from "node:path";

const langwatchHomeOverride = process.env.LANGWATCH_HOME;
const root = langwatchHomeOverride?.length ? langwatchHomeOverride : join(homedir(), ".langwatch");

export const paths = {
  root,
  bin: join(root, "bin"),
  // The @langwatch/server tree (apps/, packages/, services/langevals/, sdks/python/, etc.)
  // is relocated here on first run. tsx 4.x bypasses
  // tsconfig path-alias resolution for any source file whose parent path
  // includes "/node_modules/" (its guard against transpiling 3rd-party
  // deps), and npx unpacks INTO node_modules — so we have to move the app
  // out before pnpm scripts that depend on `~/...` aliases can work.
  app: join(root, "app"),
  data: join(root, "data"),
  redisData: join(root, "data", "redis"),
  postgresData: join(root, "data", "postgres"),
  clickhouseData: join(root, "data", "clickhouse"),
  logs: join(root, "logs"),
  pidFile: join(root, "run", "langwatch.pid"),
  lockFile: join(root, "run", "langwatch.lock"),
  envFile: join(root, ".env"),
  installManifest: join(root, "install-manifest.json"),
} as const;

export type LangwatchPaths = typeof paths;
