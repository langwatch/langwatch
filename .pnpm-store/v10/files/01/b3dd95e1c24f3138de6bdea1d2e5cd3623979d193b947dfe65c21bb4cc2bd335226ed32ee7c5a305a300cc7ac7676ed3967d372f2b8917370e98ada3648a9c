import type { AwsCredentialIdentity, AwsCredentialIdentityProvider, Logger, RequestHandler } from "@smithy/types";
import type { AwsSdkCredentialsFeatures } from "../feature-ids";
export type { IdentityProvider } from "@smithy/types";
export type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@smithy/types";
/**
 * @public
 */
export interface AwsIdentityProperties {
    /**
     * These are resolved client config values, and may be async providers.
     */
    callerClientConfig?: {
        /**
         * It is likely a programming error if you use
         * the caller client config credentials in a credential provider, since
         * it will recurse.
         *
         * @deprecated do not use.
         */
        credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
        /**
         * @internal
         * @deprecated minimize use.
         */
        credentialDefaultProvider?: (input?: any) => AwsCredentialIdentityProvider;
        logger?: Logger;
        profile?: string;
        region(): Promise<string>;
        requestHandler?: RequestHandler<any, any>;
        userAgentAppId?(): Promise<string | undefined>;
    };
}
/**
 * Variation of {@link IdentityProvider} which accepts a contextual
 * client configuration that includes an AWS region and potentially other
 * configurable fields.
 *
 * Used to link a credential provider to a client if it is being called
 * in the context of a client.
 *
 * @public
 */
export type RuntimeConfigIdentityProvider<T> = (awsIdentityProperties?: AwsIdentityProperties) => Promise<T>;
/**
 * Variation of {@link AwsCredentialIdentityProvider} which accepts a contextual
 * client configuration that includes an AWS region and potentially other
 * configurable fields.
 *
 * Used to link a credential provider to a client if it is being called
 * in the context of a client.
 *
 * @public
 */
export type RuntimeConfigAwsCredentialIdentityProvider = RuntimeConfigIdentityProvider<AwsCredentialIdentity>;
/**
 * AwsCredentialIdentity with source attribution metadata.
 * @public
 */
export type AttributedAwsCredentialIdentity = AwsCredentialIdentity & {
    $source?: AwsSdkCredentialsFeatures;
};
