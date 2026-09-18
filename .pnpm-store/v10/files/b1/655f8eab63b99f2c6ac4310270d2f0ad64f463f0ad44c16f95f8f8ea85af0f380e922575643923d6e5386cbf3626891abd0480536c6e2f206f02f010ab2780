"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAllEnvVars = exports.readEnvVar = void 0;
const api_1 = require("@opentelemetry/api");
const core_1 = require("@opentelemetry/core");
const EnvDefinition_1 = require("./EnvDefinition");
function readStringEnv(def) {
    const value = (0, core_1.getStringFromEnv)(def.key);
    if (value == null) {
        return def.defaultValue;
    }
    if (def.allowedValues && !def.allowedValues.includes(value)) {
        api_1.diag.warn(`Invalid value "${value}" for ${def.description} (env: ${def.key}). ` +
            `Expected one of: ${def.allowedValues.join(', ')}. ` +
            (def.defaultValue != null
                ? `Falling back to "${def.defaultValue}".`
                : 'Value will be ignored.'));
        return def.defaultValue;
    }
    return value;
}
function readBooleanEnv(def) {
    const raw = (0, core_1.getStringFromEnv)(def.key)?.trim().toLowerCase();
    // Handle the case where the env var is not set (no warning).
    if (raw == null || raw === '') {
        return def.defaultValue;
    }
    if (raw === 'true') {
        return true;
    }
    if (raw === 'false') {
        return false;
    }
    // If set to an unrecognized value, warn and fall back to the default.
    api_1.diag.warn(`Invalid value "${raw}" for ${def.description} (env: ${def.key}). ` +
        `Expected 'true' or 'false'. Falling back to "${def.defaultValue}".`);
    return def.defaultValue;
}
function readEnvVar(def) {
    switch (def.type) {
        case 'string':
            return readStringEnv(def);
        case 'boolean':
            return readBooleanEnv(def);
    }
}
exports.readEnvVar = readEnvVar;
function readAllEnvVars() {
    const result = {};
    for (const [name, def] of Object.entries(EnvDefinition_1.ENV_DEFS)) {
        result[name] = readEnvVar(def);
    }
    return result;
}
exports.readAllEnvVars = readAllEnvVars;
//# sourceMappingURL=EnvReader.js.map