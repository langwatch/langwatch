import { CredentialsProviderError } from "@smithy/core/config";
/**
 * A specific sub-case of CredentialsProviderError, when the IMDSv1 fallback
 * has been attempted but shut off by SDK configuration.
 *
 * @public
 */
export declare class InstanceMetadataV1FallbackError extends CredentialsProviderError {
    readonly tryNextLink: boolean;
    name: string;
    constructor(message: string, tryNextLink?: boolean);
}
