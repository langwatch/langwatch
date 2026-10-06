import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** Evaluator's settings: only the shared deployment origin its platform URLs are built on. */
export const evaluatorConfig = Config.define(() => ({ publicBaseUrl }));

export type EvaluatorServerConfig = ConfigOf<typeof evaluatorConfig>;
