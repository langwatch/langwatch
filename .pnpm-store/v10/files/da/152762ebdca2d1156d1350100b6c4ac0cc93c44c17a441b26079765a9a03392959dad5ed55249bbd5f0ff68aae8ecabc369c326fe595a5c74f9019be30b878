import type { ConfigFactory } from './IConfigFactory';
import type { AttributeNameValue, ConfigurationModel, TextMapPropagator } from './generated/types';
export declare class FileConfigFactory implements ConfigFactory {
    private _config;
    constructor();
    getConfigModel(): ConfigurationModel;
}
export declare function parseConfigFile(): ConfigurationModel;
/**
 * Merge attributes from `resource.attributes` and `resource.attributes_list`
 * (comma-separated key=value pairs) into an `AttributeNameValue[]` array.
 * Entries already in `resource.attributes` taking precedence.
 *
 * Note: The returned array might not be a copy, so it should not be mutated.
 */
export declare function mergeResourceAttributesConfig(attributes?: AttributeNameValue[], attributes_list?: string | null): AttributeNameValue[] | undefined;
/**
 * Merge propagator.composite_list (comma-separated propagator names) into
 * propagator.composite, with entries already in composite taking precedence.
 * Merge TextMapPropagator configs from `propagator.composite` and `propagator.composite_list`
 * (comma-separated names) into a `TextMapPropagator[]` array.
 * Entries already in `propagator.composite` taking precedence.
 *
 * Note: The returned array might not be a copy, so it should not be mutated.
 */
export declare function mergePropagatorCompositeConfig(composite?: TextMapPropagator[], composite_list?: string | null): TextMapPropagator[] | undefined;
//# sourceMappingURL=FileConfigFactory.d.ts.map