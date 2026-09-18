import { setCredentialFeature } from "@aws-sdk/core/client";
export const isWebIdentityProfile = (arg) => Boolean(arg) &&
    typeof arg === "object" &&
    typeof arg.web_identity_token_file === "string" &&
    typeof arg.role_arn === "string" &&
    ["undefined", "string"].indexOf(typeof arg.role_session_name) > -1;
export const resolveWebIdentityCredentials = async (profile, options, callerClientConfig) => {
    const { fromTokenFile } = await import("@aws-sdk/credential-provider-web-identity");
    const credentials = await fromTokenFile({
        webIdentityTokenFile: profile.web_identity_token_file,
        roleArn: profile.role_arn,
        roleSessionName: profile.role_session_name,
        roleAssumerWithWebIdentity: options.roleAssumerWithWebIdentity,
        logger: options.logger,
        parentClientConfig: options.parentClientConfig,
    })({
        callerClientConfig,
    });
    return setCredentialFeature(credentials, "CREDENTIALS_PROFILE_STS_WEB_ID_TOKEN", "q");
};
