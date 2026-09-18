export { AwsSdkSigV4Signer, AWSSDKSigV4Signer, validateSigningProperties, AwsSdkSigV4ASigner, NODE_AUTH_SCHEME_PREFERENCE_OPTIONS, resolveAwsSdkSigV4AConfig, NODE_SIGV4A_CONFIG_OPTIONS, } from "./aws_sdk";
export { getBearerTokenEnvKey } from "./utils/getBearerTokenEnvKey";
import { bindResolveAwsSdkSigV4Config } from "./aws_sdk";
import { DEFAULT_DISABLE_CLOCK_SKEW_CORRECTION } from "./aws_sdk/clock-skew-defaults";
export const resolveAwsSdkSigV4Config = bindResolveAwsSdkSigV4Config(DEFAULT_DISABLE_CLOCK_SKEW_CORRECTION);
export const resolveAWSSDKSigV4Config = resolveAwsSdkSigV4Config;
