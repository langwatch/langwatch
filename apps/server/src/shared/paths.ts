import { homedir } from "node:os";
import { join } from "node:path";

const root = process.env.LANGWATCH_HOME?.length
  ? process.env.LANGWATCH_HOME
  : join(homedir(), ".langwatch");

export const paths = {
  root,
  bin: join(root, "bin"),
  // Relocated here on first run: tsx 4.x won't resolve tsconfig path
  // aliases for source under "/node_modules/" (its 3rd-party guard), and
  // npx unpacks there — so pnpm scripts using `~/...` aliases need this.
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
