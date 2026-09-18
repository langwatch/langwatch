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
import { DiagLogLevel } from '@opentelemetry/api';
import type { SeverityNumberConfigModel } from '@opentelemetry/configuration';
/**
 * @throws Error if `sevNum` is not a known value from the Configuration schema.
 */
export declare function diagLogLevelFromSeverityNumberConfig(sevNum?: SeverityNumberConfigModel): DiagLogLevel;
//# sourceMappingURL=diag.d.ts.map