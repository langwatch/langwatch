const no = Symbol.for("node-only");
export { AwsSdkSigV4Signer, AWSSDKSigV4Signer, validateSigningProperties, AwsSdkSigV4ASigner, resolveAwsSdkSigV4AConfig, } from "./aws_sdk";
export { getBearerTokenEnvKey } from "./utils/getBearerTokenEnvKey";
export const NODE_AUTH_SCHEME_PREFERENCE_OPTIONS = no;
export const NODE_SIGV4A_CONFIG_OPTIONS = no;
import { bindResolveAwsSdkSigV4Config } from "./aws_sdk";
import { DEFAULT_DISABLE_CLOCK_SKEW_CORRECTION } from "./aws_sdk/clock-skew-defaults.browser";
export const resolveAwsSdkSigV4Config = bindResolveAwsSdkSigV4Config(DEFAULT_DISABLE_CLOCK_SKEW_CORRECTION);
export const resolveAWSSDKSigV4Config = resolveAwsSdkSigV4Config;
