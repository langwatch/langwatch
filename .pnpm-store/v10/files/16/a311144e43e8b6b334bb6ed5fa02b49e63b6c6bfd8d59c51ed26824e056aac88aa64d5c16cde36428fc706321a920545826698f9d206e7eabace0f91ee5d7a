import { AwsIdentityProperties } from "@aws-sdk/types";
import { SSOToken } from "@smithy/core/config";
import { FromSsoInit } from "./fromSso";
export declare const getNewSsoOidcToken: (
  ssoToken: SSOToken,
  ssoRegion: string,
  init?: FromSsoInit,
  callerClientConfig?: AwsIdentityProperties["callerClientConfig"],
) => Promise<import("@aws-sdk/nested-clients/sso-oidc").CreateTokenCommandOutput>;
