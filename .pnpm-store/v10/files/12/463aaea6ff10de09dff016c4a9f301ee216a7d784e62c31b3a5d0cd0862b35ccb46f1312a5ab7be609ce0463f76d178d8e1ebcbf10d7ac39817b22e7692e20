"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.getLogger = getLogger;
const debug_1 = __importDefault(require("debug"));
const config_1 = require("./config.js");
/**
 * By default we don't log LLM inputs/outputs, to prevent exposing sensitive data. Set this flag
 * to enable logging them.
 */
const dontLogModelData = config_1.logging.dontLogModelData;
/**
 * By default we don't log tool inputs/outputs, to prevent exposing sensitive data. Set this flag
 * to enable logging them.
 */
const dontLogToolData = config_1.logging.dontLogToolData;
/**
 * Get a logger for a given package.
 *
 * @param namespace - the namespace to use for the logger.
 * @returns A logger object with `debug` and `error` methods.
 */
function getLogger(namespace = 'openai-agents') {
    return {
        namespace,
        debug: (0, debug_1.default)(namespace),
        error: console.error,
        warn: console.warn,
        dontLogModelData,
        dontLogToolData,
    };
}
exports.logger = getLogger('openai-agents:core');
exports.default = exports.logger;
//# sourceMappingURL=logger.js.map