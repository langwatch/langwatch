"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConfigFactory = void 0;
const core_1 = require("@opentelemetry/core");
const EnvironmentConfigFactory_1 = require("./EnvironmentConfigFactory");
const FileConfigFactory_1 = require("./FileConfigFactory");
function createConfigFactory() {
    const configFile = (0, core_1.getStringFromEnv)('OTEL_CONFIG_FILE');
    if (configFile) {
        return new FileConfigFactory_1.FileConfigFactory();
    }
    return new EnvironmentConfigFactory_1.EnvironmentConfigFactory();
}
exports.createConfigFactory = createConfigFactory;
//# sourceMappingURL=ConfigFactory.js.map