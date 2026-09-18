import type { CredentialProviderOptions } from "@aws-sdk/types";
import { AwsCredentialIdentity, Logger, Provider } from "@smithy/types";
import { AssumeRoleCommandInput } from "./commands/AssumeRoleCommand";
import { AssumeRoleWithWebIdentityCommandInput } from "./commands/AssumeRoleWithWebIdentityCommand";
import type { STSClient, STSClientConfig } from "./STSClient";
/**
 * @public
 */
export type STSRoleAssumerOptions = Pick<STSClientConfig, "logger" | "region" | "requestHandler" | "profile" | "userAgentAppId"> & {
    credentialProviderLogger?: Logger;
    parentClientConfig?: CredentialProviderOptions["parentClientConfig"];
};
/**
 * @internal
 */
export type RoleAssumer = (sourceCreds: AwsCredentialIdentity, params: AssumeRoleCommandInput) => Promise<AwsCredentialIdentity>;
/**
 * The default role assumer that used by credential providers when sts:AssumeRole API is needed.
 * @internal
 */
export declare const getDefaultRoleAssumer: (stsOptions: STSRoleAssumerOptions, STSClient: new (options: STSClientConfig) => STSClient) => RoleAssumer;
/**
 * @internal
 */
export type RoleAssumerWithWebIdentity = (params: AssumeRoleWithWebIdentityCommandInput) => Promise<AwsCredentialIdentity>;
/**
 * The default role assumer that used by credential providers when sts:AssumeRoleWithWebIdentity API is needed.
 * @internal
 */
export declare const getDefaultRoleAssumerWithWebIdentity: (stsOptions: STSRoleAssumerOptions, STSClient: new (options: STSClientConfig) => STSClient) => RoleAssumerWithWebIdentity;
/**
 * @internal
 */
export type DefaultCredentialProvider = (input: any) => Provider<AwsCredentialIdentity>;
