import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleUrl = import.meta.url;
const packageRoot = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..");
const monorepoRoot = path.resolve(packageRoot, "..", "..");

export const pipelineRoot = path.join(
  monorepoRoot,
  "src",
  "server",
  "event-sourcing",
  "pipelines",
);

export const globalProjectionsRoot = path.join(
  monorepoRoot,
  "src",
  "server",
  "event-sourcing",
  "projections",
  "global",
);

export const projectRoot = monorepoRoot;
export const packageDirectory = packageRoot;
