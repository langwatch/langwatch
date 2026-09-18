/**
 * A logger instance with debug, error, warn, and dontLogModelData and dontLogToolData methods.
 */
export type Logger = {
    /**
     * The namespace used for the debug logger.
     */
    namespace: string;
    /**
     * Log a debug message when debug logging is enabled.
     * @param message - The message to log.
     * @param args - The arguments to log.
     */
    debug: (message: string, ...args: any[]) => void;
    /**
     * Log an error message.
     * @param message - The message to log.
     * @param args - The arguments to log.
     */
    error: (message: string, ...args: any[]) => void;
    /**
     * Log a warning message.
     * @param message - The message to log.
     * @param args - The arguments to log.
     */
    warn: (message: string, ...args: any[]) => void;
    /**
     * Whether to log model data.
     */
    dontLogModelData: boolean;
    /**
     * Whether to log tool data.
     */
    dontLogToolData: boolean;
};
/**
 * Get a logger for a given package.
 *
 * @param namespace - the namespace to use for the logger.
 * @returns A logger object with `debug` and `error` methods.
 */
export declare function getLogger(namespace?: string): Logger;
export declare const logger: Logger;
export default logger;
