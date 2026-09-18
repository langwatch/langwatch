import debug from 'debug';
import { logging } from "./config.mjs";
/**
 * By default we don't log LLM inputs/outputs, to prevent exposing sensitive data. Set this flag
 * to enable logging them.
 */
const dontLogModelData = logging.dontLogModelData;
/**
 * By default we don't log tool inputs/outputs, to prevent exposing sensitive data. Set this flag
 * to enable logging them.
 */
const dontLogToolData = logging.dontLogToolData;
/**
 * Get a logger for a given package.
 *
 * @param namespace - the namespace to use for the logger.
 * @returns A logger object with `debug` and `error` methods.
 */
export function getLogger(namespace = 'openai-agents') {
    return {
        namespace,
        debug: debug(namespace),
        error: console.error,
        warn: console.warn,
        dontLogModelData,
        dontLogToolData,
    };
}
export const logger = getLogger('openai-agents:core');
export default logger;
//# sourceMappingURL=logger.mjs.map