import { Config, type ConfigOf } from "@langwatch/config";

export const instantEvalConfig = Config.define(() => ({}));

export type InstantEvalServerConfig = ConfigOf<typeof instantEvalConfig>;
