import { setCredentialFeature } from "@aws-sdk/core/client";
export const isProcessProfile = (arg) => Boolean(arg) && typeof arg === "object" && typeof arg.credential_process === "string";
export const resolveProcessCredentials = async (options, profile) => {
    const { fromProcess } = await import("@aws-sdk/credential-provider-process");
    const credentials = await fromProcess({
        ...options,
        profile,
    })();
    return setCredentialFeature(credentials, "CREDENTIALS_PROFILE_PROCESS", "v");
};
