"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHttpTlsConfig = exports.initializeDefaultLoggerProviderConfiguration = exports.initializeDefaultMeterProviderConfiguration = exports.initializeDefaultTracerProviderConfiguration = exports.initializeDefaultConfiguration = exports.getGrpcTlsConfig = exports.substituteEnvVars = void 0;
const yaml = require("yaml");
const core_1 = require("@opentelemetry/core");
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
function substituteEnvVars(doc) {
    // Visit each scalar string value in the document. These are
    // the candidates for env var substitution.
    yaml.visit(doc, {
        Scalar: (key, node, _path) => {
            if (key === 'key')
                return; // skip mapping keys
            if (typeof node.value !== 'string')
                return;
            let subbed = envVarSubst(node.value);
            if (subbed !== node.value && node.type === yaml.Scalar.PLAIN) {
                // "PLAIN" here is a simple YAML value (e.g. 42 in `foo: 42`).
                // I.e., not quoted (`foo: "42"`) or in a block.
                subbed = yamlScalarCoerce(subbed);
            }
            node.value = subbed;
        },
    });
}
exports.substituteEnvVars = substituteEnvVars;
// ENV_SUBSTITUTION_RE *mostly* matches the `ENV-SUBSTITUTION` ABNF from the
// spec with the exception of the DEFAULT-VALUE: we are using `[^\n}]*`
// (copying the OTel Java regex) rather than a regex closer to ABNF
// `*(VCHAR-WSP-NO-RBRACE)` (which is slightly ambiguous on what whitespace is
// allowed in WSP).
const ENV_SUBSTITUTION_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)(?::-([^\n}]*))?$/;
/**
 * Do environment variable substitution for the given string value.
 */
function envVarSubst(s) {
    const ESCAPE_RE = /(\$\$)/;
    const chunks = s.split(ESCAPE_RE);
    for (let i = 0; i < chunks.length; ++i) {
        if (i % 2 === 1) {
            // Odd chunks are matched escape sequences, i.e. '$$'.
            chunks[i] = '$';
            continue;
        }
        // Even chunks are processed for possible substition matches.
        const SUBSTITUTION_REF_RE = /\$\{(?:env:)?([^}]+)\}/g;
        let chunk = '';
        let lastIndex = 0;
        let match;
        while ((match = SUBSTITUTION_REF_RE.exec(chunks[i])) !== null) {
            chunk += chunks[i].slice(lastIndex, match.index);
            const envMatch = ENV_SUBSTITUTION_RE.exec(match[1]);
            if (!envMatch) {
                // E.g.: `key: ${STRING_VALUE:?error}` test case
                throw new Error(`parse error: invalid env var substitution: ${match[0]}`);
            }
            const envName = envMatch[1];
            const defaultValue = envMatch[2] ?? '';
            chunk += (0, core_1.getStringFromEnv)(envName) || defaultValue;
            lastIndex = SUBSTITUTION_REF_RE.lastIndex;
        }
        chunk += chunks[i].slice(lastIndex);
        chunks[i] = chunk;
    }
    const result = chunks.join('');
    return result;
}
/**
 * Re-interpret a string value from env var substitution as a possible
 * YAML number, boolean, or null value.
 *
 * If the interpretted value is any other type, we return the original
 * string:
 * - sequences and  mappings may not result from env var substitution, per the spec
 * - a re-parsed YAML string normalizes whitespace, which we do not want
 */
function yamlScalarCoerce(value) {
    let coerced;
    try {
        coerced = yaml.parse(value, { version: '1.2' });
    }
    catch {
        return value;
    }
    const type = typeof coerced;
    if (coerced === null || type === 'number' || type === 'boolean') {
        return coerced;
    }
    else {
        return value;
    }
}
function getGrpcTlsConfig(certificateFile, clientKeyFile, clientCertificateFile, insecure) {
    if (certificateFile || clientKeyFile || clientCertificateFile) {
        const tls = {};
        if (certificateFile) {
            tls.ca_file = certificateFile;
        }
        if (clientKeyFile) {
            tls.key_file = clientKeyFile;
        }
        if (clientCertificateFile) {
            tls.cert_file = clientCertificateFile;
        }
        if (insecure !== undefined) {
            tls.insecure = insecure;
        }
        return tls;
    }
    return undefined;
}
exports.getGrpcTlsConfig = getGrpcTlsConfig;
function initializeDefaultConfiguration() {
    return {
        disabled: false,
        log_level: 'info',
        resource: {},
        attribute_limits: {
            attribute_count_limit: 128,
        },
    };
}
exports.initializeDefaultConfiguration = initializeDefaultConfiguration;
function initializeDefaultTracerProviderConfiguration() {
    return {
        processors: [],
        limits: {
            attribute_count_limit: 128,
            event_count_limit: 128,
            link_count_limit: 128,
            event_attribute_count_limit: 128,
            link_attribute_count_limit: 128,
        },
        sampler: {
            parent_based: {
                root: { always_on: undefined },
                remote_parent_sampled: { always_on: undefined },
                remote_parent_not_sampled: { always_off: undefined },
                local_parent_sampled: { always_on: undefined },
                local_parent_not_sampled: { always_off: undefined },
            },
        },
    };
}
exports.initializeDefaultTracerProviderConfiguration = initializeDefaultTracerProviderConfiguration;
function initializeDefaultMeterProviderConfiguration() {
    return {
        readers: [],
        views: [],
        exemplar_filter: 'trace_based',
    };
}
exports.initializeDefaultMeterProviderConfiguration = initializeDefaultMeterProviderConfiguration;
function initializeDefaultLoggerProviderConfiguration() {
    return {
        processors: [],
        limits: { attribute_count_limit: 128 },
        'logger_configurator/development': {},
    };
}
exports.initializeDefaultLoggerProviderConfiguration = initializeDefaultLoggerProviderConfiguration;
function getHttpTlsConfig(certificateFile, clientKeyFile, clientCertificateFile) {
    if (certificateFile || clientKeyFile || clientCertificateFile) {
        const tls = {};
        if (certificateFile) {
            tls.ca_file = certificateFile;
        }
        if (clientKeyFile) {
            tls.key_file = clientKeyFile;
        }
        if (clientCertificateFile) {
            tls.cert_file = clientCertificateFile;
        }
        return tls;
    }
    return undefined;
}
exports.getHttpTlsConfig = getHttpTlsConfig;
//# sourceMappingURL=utils.js.map