"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.ConsoleLogger = exports.LogLevel = void 0;
exports.createLogger = createLogger;
exports.LogLevel = {
    Debug: "debug",
    Info: "info",
    Warn: "warn",
    Error: "error",
};
const logLevelMap = {
    [exports.LogLevel.Debug]: 1,
    [exports.LogLevel.Info]: 2,
    [exports.LogLevel.Warn]: 3,
    [exports.LogLevel.Error]: 4,
};
/**
 * Default console-based logger implementation.
 */
class ConsoleLogger {
    debug(message, ...args) {
        console.debug(message, ...args);
    }
    info(message, ...args) {
        console.info(message, ...args);
    }
    warn(message, ...args) {
        console.warn(message, ...args);
    }
    error(message, ...args) {
        console.error(message, ...args);
    }
}
exports.ConsoleLogger = ConsoleLogger;
/**
 * Logger class that provides level-based logging functionality.
 */
class Logger {
    /**
     * Creates a new logger instance.
     * @param config - Logger configuration
     */
    constructor(config) {
        this.level = logLevelMap[config.level];
        this.logger = config.logger;
        this.silent = config.silent;
    }
    /**
     * Checks if a log level should be output based on configuration.
     * @param level - The log level to check
     * @returns True if the level should be logged
     */
    shouldLog(level) {
        return !this.silent && this.level <= logLevelMap[level];
    }
    /**
     * Checks if debug logging is enabled.
     * @returns True if debug logs should be output
     */
    isDebug() {
        return this.shouldLog(exports.LogLevel.Debug);
    }
    /**
     * Logs a debug message if debug logging is enabled.
     * @param message - The message to log
     * @param args - Additional arguments to log
     */
    debug(message, ...args) {
        if (this.isDebug()) {
            this.logger.debug(message, ...args);
        }
    }
    /**
     * Checks if info logging is enabled.
     * @returns True if info logs should be output
     */
    isInfo() {
        return this.shouldLog(exports.LogLevel.Info);
    }
    /**
     * Logs an info message if info logging is enabled.
     * @param message - The message to log
     * @param args - Additional arguments to log
     */
    info(message, ...args) {
        if (this.isInfo()) {
            this.logger.info(message, ...args);
        }
    }
    /**
     * Checks if warning logging is enabled.
     * @returns True if warning logs should be output
     */
    isWarn() {
        return this.shouldLog(exports.LogLevel.Warn);
    }
    /**
     * Logs a warning message if warning logging is enabled.
     * @param message - The message to log
     * @param args - Additional arguments to log
     */
    warn(message, ...args) {
        if (this.isWarn()) {
            this.logger.warn(message, ...args);
        }
    }
    /**
     * Checks if error logging is enabled.
     * @returns True if error logs should be output
     */
    isError() {
        return this.shouldLog(exports.LogLevel.Error);
    }
    /**
     * Logs an error message if error logging is enabled.
     * @param message - The message to log
     * @param args - Additional arguments to log
     */
    error(message, ...args) {
        if (this.isError()) {
            this.logger.error(message, ...args);
        }
    }
}
exports.Logger = Logger;
function createLogger(config) {
    var _a, _b, _c;
    if (config == null) {
        return defaultLogger;
    }
    if (config instanceof Logger) {
        return config;
    }
    config = config !== null && config !== void 0 ? config : {};
    (_a = config.level) !== null && _a !== void 0 ? _a : (config.level = exports.LogLevel.Info);
    (_b = config.logger) !== null && _b !== void 0 ? _b : (config.logger = new ConsoleLogger());
    (_c = config.silent) !== null && _c !== void 0 ? _c : (config.silent = true);
    return new Logger(config);
}
const defaultLogger = new Logger({
    level: exports.LogLevel.Info,
    logger: new ConsoleLogger(),
    silent: true,
});
