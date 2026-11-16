export { AwsClientProcessRuntime } from "./process-runtime.ts";
export {
  defaultS3Host,
  S3BucketNotFoundError,
  S3RegionNotFoundError,
  s3RegionFor,
  s3RegionOf,
  type S3BucketRegionAnswer,
} from "./s3-region.ts";
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
