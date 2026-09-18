"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProvider = createProvider;
exports.configureProvider = configureProvider;
/**
 * A provider factory such as `bedrock(options)` captures configuration in a
 * definition, while every OpenAI client receives a fresh runtime from
 * `definition.configure()`. Keeping definitions out of the provider object
 * makes providers opaque and prevents arbitrary objects from imitating one.
 * It also leaves provider-specific dependencies outside the core SDK.
 *
 * The registry lives on `globalThis` under a global symbol so a provider made
 * by one copy of the package still works with another copy, including mixed
 * CommonJS and ESM installations. The WeakMap avoids retaining discarded
 * provider configurations.
 */
const providerDefinitionsKey = Symbol.for('openai.node.providerDefinitions.v1');
const providerGlobal = globalThis;
const existingProviderDefinitions = providerGlobal[providerDefinitionsKey];
const providerDefinitions = existingProviderDefinitions ?? new WeakMap();
if (!existingProviderDefinitions) {
    Object.defineProperty(providerGlobal, providerDefinitionsKey, { value: providerDefinitions });
}
function createProvider(definition) {
    const provider = Object.freeze({});
    providerDefinitions.set(provider, definition);
    return provider;
}
function configureProvider(provider) {
    const definition = providerDefinitions.get(provider);
    if (!definition) {
        throw new Error('Invalid provider. Providers must be created with createProvider().');
    }
    return definition.configure();
}
//# sourceMappingURL=provider.js.map