import type { FinalRequestOptions } from "./request-options.mjs";
import type { FinalizedRequestInit } from "./types.mjs";
declare const providerBrand: unique symbol;
/** An opaque provider configuration created by {@link createProvider}. */
export interface Provider {
    readonly [providerBrand]: true;
}
export interface ProviderRequestContext {
    url: string;
    options: FinalRequestOptions;
}
export interface ProviderRuntime {
    name: string;
    baseURL: string;
    prepareRequest?(request: FinalizedRequestInit, context: ProviderRequestContext): void | Promise<void>;
}
export interface ProviderDefinition {
    configure(): ProviderRuntime;
}
export declare function createProvider(definition: ProviderDefinition): Provider;
export declare function configureProvider(provider: Provider): ProviderRuntime;
export {};
//# sourceMappingURL=provider.d.mts.map