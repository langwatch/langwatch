import { loadEnv as _loadEnv, isBrowserEnvironment, } from '@openai/agents-core/_shims';
/**
 * Loads environment variables from the process environment.
 *
 * @returns An object containing the environment variables.
 */
export function loadEnv() {
    return _loadEnv();
}
/**
 * Checks if a flag is enabled in the environment.
 *
 * @param flagName - The name of the flag to check.
 * @returns `true` if the flag is enabled, `false` otherwise.
 */
function isEnabled(flagName) {
    const env = loadEnv();
    return (typeof env !== 'undefined' &&
        (env[flagName] === 'true' || env[flagName] === '1'));
}
/**
 * Global configuration for tracing.
 */
export const tracing = {
    get disabled() {
        if (isBrowserEnvironment()) {
            return true;
        }
        else if (loadEnv().NODE_ENV === 'test') {
            // disabling by default in tests
            return true;
        }
        return isEnabled('OPENAI_AGENTS_DISABLE_TRACING');
    },
};
/**
 * Global configuration for logging.
 */
export const logging = {
    get dontLogModelData() {
        return isEnabled('OPENAI_AGENTS_DONT_LOG_MODEL_DATA');
    },
    get dontLogToolData() {
        return isEnabled('OPENAI_AGENTS_DONT_LOG_TOOL_DATA');
    },
};
//# sourceMappingURL=config.mjs.map