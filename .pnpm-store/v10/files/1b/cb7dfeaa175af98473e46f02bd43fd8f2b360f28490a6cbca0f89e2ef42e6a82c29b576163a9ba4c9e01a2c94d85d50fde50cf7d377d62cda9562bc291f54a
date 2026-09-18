import { setCredentialFeature } from "@aws-sdk/core/client";
export const isLoginProfile = (data) => {
    return Boolean(data && data.login_session);
};
export const resolveLoginCredentials = async (profileName, options, callerClientConfig) => {
    const { fromLoginCredentials } = await import("@aws-sdk/credential-provider-login");
    const credentials = await fromLoginCredentials({
        ...options,
        profile: profileName,
    })({ callerClientConfig });
    return setCredentialFeature(credentials, "CREDENTIALS_PROFILE_LOGIN", "AC");
};
