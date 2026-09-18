"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logging = exports.tracing = void 0;
exports.loadEnv = loadEnv;
// Use function instead of exporting the value to prevent
// circular dependency resolution issues caused by other exports in '@openai/agents-core/_shims'
const _shims_1 = require("@openai/agents-core/_shims");
/**
 * Loads environment variables from the process environment.
 *
 * @returns An object containing the environment variables.
 */
function loadEnv() {
    return (0, _shims_1.loadEnv)();
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
exports.tracing = {
    get disabled() {
        if ((0, _shims_1.isBrowserEnvironment)()) {
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
exports.logging = {
    get dontLogModelData() {
        return isEnabled('OPENAI_AGENTS_DONT_LOG_MODEL_DATA');
    },
    get dontLogToolData() {
        return isEnabled('OPENAI_AGENTS_DONT_LOG_TOOL_DATA');
    },
};
//# sourceMappingURL=config.js.map