import type { SupportedPlatform } from "../shared/platform.ts";
import type { LangwatchPaths } from "../shared/paths.ts";

export type PredepId = "uv" | "postgres" | "redis" | "clickhouse" | "goose" | "aigateway";

export type DetectionResult =
  | { installed: true; version: string; resolvedPath: string }
  | { installed: false; reason: string };

// Subset of listr2's TaskWrapper that we actually use during install.
// listr2's ListrTaskWrapper has three generic parameters that vary by
// renderer; capturing them precisely fights the actual default-renderer
// instances we hand in. The minimal surface keeps the predep modules
// independent of which renderer the runner picks.
export type PredepTask = {
  output: string | undefined;
  title?: string;
};

export type InstallContext = {
  platform: SupportedPlatform;
  paths: LangwatchPaths;
  task: PredepTask;
};

export type Predep = {
  id: PredepId;
  label: string;
  required: boolean;
  detect(paths: LangwatchPaths): Promise<DetectionResult>;
  install(ctx: InstallContext): Promise<{ version: string; resolvedPath: string }>;
};
