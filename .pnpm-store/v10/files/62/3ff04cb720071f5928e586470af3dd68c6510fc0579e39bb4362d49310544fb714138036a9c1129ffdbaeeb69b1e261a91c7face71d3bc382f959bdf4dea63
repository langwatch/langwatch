"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagLogLevelFromSeverityNumberConfig = void 0;
/**
 * # Configuring the internal diag logger level
 *
 * Before OpenTelemetry declarative configuration there was a loosely defined
 * `OTEL_LOG_LEVEL` used by *some* OTel SDK languages, including OTel JS.
 * The supported values were never standardized.
 *
 * With declarative configuration, OpenTelemetry standardized `log_level` to
 * the set of SeverityNumber values defined by the Logs API, but as lowercase
 * string names.
 * https://github.com/open-telemetry/opentelemetry-configuration/blob/main/schema-docs.md#severitynumber
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/#displaying-severity
 *
 * The following is the mapping between log levels:
 *
 * | DiagLogLevel | OTEL_LOG_LEVEL | `log_level` Configuration |
 * | ------------ | -------------- | ------------------------- |
 * | NONE (0)     | "NONE"         | use "fatal", "fatal2", "fatal3", or "fatal4" |
 * | ERROR (30)   | "ERROR"        | error, error2, error3, error4 |
 * | WARN (50)    | "WARN"         | warn, warn2, warn3, warn4 |
 * | INFO (60)    | "INFO"         | info, info2, info3, info4 |
 * | DEBUG (70)   | "DEBUG"        | debug, debug2, debug3, debug4 |
 * | VERBOSE (80) | "VERBOSE"      | trace2, trace3, trace4    |
 * | ALL (9999)   | "ALL"          | use "trace"               |
 *
 * Notable differences between `OTEL_LOG_LEVEL` and `log_level`:
 *
 * - `OTEL_LOG_LEVEL` envvar values are case-insensitive.
 * - `log_level` Declarative Configuration values are case-sensitive.
 * - `log_level` values do not have direct values for "NONE" or "ALL".
 *   Using "trace" for ALL and "fatal" for NONE are functionally equivalent.
 * - Declarative Configuration specifies to default to "info" level.
 *
 * See https://github.com/open-telemetry/opentelemetry-specification/issues/2039#issuecomment-4306774443
 * for discussion.
 *
 * See also:
 * - `diagLogLevelFromString()` from `@opentelemetry/core`.
 * - `severityNumberConfigFromLogLevelString()` in `@opentelemetry/configuration`.
 */
const api_1 = require("@opentelemetry/api");
/* istanbul ignore next */
/**
 * @throws Error if `sevNum` is not a known value from the Configuration schema.
 */
function diagLogLevelFromSeverityNumberConfig(sevNum = 'info') {
    let level;
    switch (sevNum) {
        case 'trace':
            level = api_1.DiagLogLevel.ALL;
            break;
        case 'trace2':
        case 'trace3':
        case 'trace4':
            level = api_1.DiagLogLevel.VERBOSE;
            break;
        case 'debug':
        case 'debug2':
        case 'debug3':
        case 'debug4':
            level = api_1.DiagLogLevel.DEBUG;
            break;
        case 'info':
        case 'info2':
        case 'info3':
        case 'info4':
            level = api_1.DiagLogLevel.INFO;
            break;
        case 'warn':
        case 'warn2':
        case 'warn3':
        case 'warn4':
            level = api_1.DiagLogLevel.WARN;
            break;
        case 'error':
        case 'error2':
        case 'error3':
        case 'error4':
            level = api_1.DiagLogLevel.ERROR;
            break;
        case 'fatal':
        case 'fatal2':
        case 'fatal3':
        case 'fatal4':
            level = api_1.DiagLogLevel.NONE;
            break;
        default:
            throw new Error(`unexpected SeverityNumberConfigModel value: ${sevNum}`);
    }
    return level;
}
exports.diagLogLevelFromSeverityNumberConfig = diagLogLevelFromSeverityNumberConfig;
//# sourceMappingURL=diag.js.map