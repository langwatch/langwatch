import type { ListrTaskWrapper } from "listr2";
import type { SupportedPlatform } from "../shared/platform.ts";
import type { LangwatchPaths } from "../shared/paths.ts";

export type PredepId = "uv" | "postgres" | "redis" | "clickhouse" | "aigateway";

export type DetectionResult =
  | { installed: true; version: string; resolvedPath: string }
  | { installed: false; reason: string };

export type InstallContext = {
  platform: SupportedPlatform;
  paths: LangwatchPaths;
  task: ListrTaskWrapper<unknown, never, never>;
};

export type Predep = {
  id: PredepId;
  label: string;
  required: boolean;
  detect(paths: LangwatchPaths): Promise<DetectionResult>;
  install(ctx: InstallContext): Promise<{ version: string; resolvedPath: string }>;
};
