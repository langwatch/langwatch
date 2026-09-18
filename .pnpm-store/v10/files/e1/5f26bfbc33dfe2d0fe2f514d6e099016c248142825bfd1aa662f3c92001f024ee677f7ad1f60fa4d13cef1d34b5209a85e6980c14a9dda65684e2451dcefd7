import * as yaml from 'yaml';
import type { ConfigurationModel, GrpcTls, HttpTls } from './generated/types';
/**
 * Handle (Environment) variable substitution per
 * https://opentelemetry.io/docs/specs/otel/configuration/data-model/#environment-variable-substitution
 *
 * This changes the yaml.Document in-place.
 * This must work with a yaml.Document, rather than a raw JS object from
 * `yaml.parse()`, to distinguish between `foo: ${BAR}` and `foo: "${BAR}"`.
 *
 * Exported for testing.
 */
export declare function substituteEnvVars(doc: yaml.Document): void;
export declare function getGrpcTlsConfig(certificateFile?: string, clientKeyFile?: string, clientCertificateFile?: string, insecure?: boolean): GrpcTls | undefined;
export declare function initializeDefaultConfiguration(): ConfigurationModel;
export declare function initializeDefaultTracerProviderConfiguration(): NonNullable<ConfigurationModel['tracer_provider']>;
export declare function initializeDefaultMeterProviderConfiguration(): NonNullable<ConfigurationModel['meter_provider']>;
export declare function initializeDefaultLoggerProviderConfiguration(): NonNullable<ConfigurationModel['logger_provider']>;
export declare function getHttpTlsConfig(certificateFile?: string, clientKeyFile?: string, clientCertificateFile?: string): HttpTls | undefined;
//# sourceMappingURL=utils.d.ts.map