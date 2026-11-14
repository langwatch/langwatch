export { AwsClientProcessRuntime } from "./process-runtime.ts";
export { defaultS3Host, s3RegionOf } from "./s3-region.ts";
export {
  findLwaPreludeSeparator,
  LWA_DEFAULT_STATUS,
  LWA_PRELUDE_SEPARATOR_LENGTH,
  readLwaPreludeStatus,
  readLwaResponsePayload,
} from "./lambda-web-adapter.ts";
export {
  AwsClientConfiguration,
  OutboundProxyResolver,
  staticCredentialsOrUndefined,
  type AssumeRoleCredentials,
  type AwsClientConfig,
  type AwsClientConfigInput,
  type AwsClientRequestHandler,
  type AwsStaticCredentialIdentity,
  type StaticAwsCredentials,
} from "./aws-client.ts";
