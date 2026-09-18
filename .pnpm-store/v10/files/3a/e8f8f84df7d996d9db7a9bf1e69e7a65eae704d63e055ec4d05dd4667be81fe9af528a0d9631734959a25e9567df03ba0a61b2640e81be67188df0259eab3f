import { type BedrockBearerOptions, type BedrockEndpointOptions } from "../../internal/bedrock.js";
import { type Provider } from "../../internal/provider.js";
export interface AwsCredentialIdentity {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiration?: Date;
}
export type AwsCredentialsProvider = () => AwsCredentialIdentity | Promise<AwsCredentialIdentity>;
export interface BedrockProviderOptions extends BedrockEndpointOptions, BedrockBearerOptions {
    /** Explicit AWS access key ID. Must be paired with secretAccessKey. */
    accessKeyId?: string | undefined;
    /** Explicit AWS secret access key. Must be paired with accessKeyId. */
    secretAccessKey?: string | undefined;
    /** Optional session token for explicit temporary AWS credentials. */
    sessionToken?: string | undefined;
    /** Explicit AWS shared-config profile. */
    profile?: string | undefined;
    /** A refreshable provider returning AWS credentials. */
    credentialProvider?: AwsCredentialsProvider | undefined;
}
/** Configure the standard OpenAI client for Amazon Bedrock using bearer or AWS authentication. */
export declare function bedrock(options?: BedrockProviderOptions): Provider;
//# sourceMappingURL=aws.d.ts.map