import { join } from "node:path";
import type { LangwatchPaths } from "../shared/paths.ts";

export type ServiceName =
  | "postgres"
  | "redis"
  | "clickhouse"
  | "nlpgo"
  | "langwatch_nlp"
  | "langevals"
  | "aigateway"
  | "langwatch"
  | "workers"
  | "bullboard";

export type ServicePaths = {
  log(name: ServiceName): string;
  pid(name: ServiceName): string;
  venv(name: "langevals" | "langwatch_nlp"): string;
  redisConf: string;
  clickhouseConfigDir: string;
};

export function servicePaths(p: LangwatchPaths): ServicePaths {
  const root = p.root;
  return {
    log: (name) => join(p.logs, `${name}.log`),
    pid: (name) => join(root, "run", `${name}.pid`),
    venv: (name) => join(root, "venvs", name),
    redisConf: join(root, "data", "redis", "redis.conf"),
    clickhouseConfigDir: join(root, "data", "clickhouse", "config"),
  };
}
