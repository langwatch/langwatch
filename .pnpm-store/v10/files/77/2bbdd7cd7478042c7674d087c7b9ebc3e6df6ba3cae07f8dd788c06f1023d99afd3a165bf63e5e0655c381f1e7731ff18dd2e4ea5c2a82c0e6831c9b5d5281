import { booleanSelector, SelectorType } from "@smithy/core/config";
export const ENV_DISABLE_CLOCK_SKEW_CORRECTION = "AWS_DISABLE_CLOCK_SKEW_CORRECTION";
export const CONFIG_DISABLE_CLOCK_SKEW_CORRECTION = "disable_clock_skew_correction";
export const NODE_DISABLE_CLOCK_SKEW_CORRECTION_CONFIG_OPTIONS = {
    environmentVariableSelector: (env) => booleanSelector(env, ENV_DISABLE_CLOCK_SKEW_CORRECTION, SelectorType.ENV),
    configFileSelector: (profile) => booleanSelector(profile, CONFIG_DISABLE_CLOCK_SKEW_CORRECTION, SelectorType.CONFIG),
    default: false,
};
