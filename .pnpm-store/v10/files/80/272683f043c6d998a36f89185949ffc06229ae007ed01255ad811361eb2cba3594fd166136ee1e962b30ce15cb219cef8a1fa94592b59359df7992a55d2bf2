const { ENV_KEY, ENV_SECRET, fromEnv } = require("@aws-sdk/credential-provider-env");
const { chain, CredentialsProviderError, ENV_PROFILE } = require("@smithy/core/config");

const ENV_IMDS_DISABLED = "AWS_EC2_METADATA_DISABLED";
const remoteProvider = async (init) => {
    const { ENV_CMDS_FULL_URI, ENV_CMDS_RELATIVE_URI, fromContainerMetadata, fromInstanceMetadata } = require('@smithy/credential-provider-imds');
    if (process.env[ENV_CMDS_RELATIVE_URI] || process.env[ENV_CMDS_FULL_URI]) {
        init.logger?.debug("@aws-sdk/credential-provider-node - remoteProvider::fromHttp/fromContainerMetadata");
        const { fromHttp } = require('@aws-sdk/credential-provider-http');
        return chain(fromHttp(init), fromContainerMetadata(init));
    }
    if (process.env[ENV_IMDS_DISABLED] && process.env[ENV_IMDS_DISABLED] !== "false") {
        return async () => {
            throw new CredentialsProviderError("EC2 Instance Metadata Service access disabled", { logger: init.logger });
        };
    }
    init.logger?.debug("@aws-sdk/credential-provider-node - remoteProvider::fromInstanceMetadata");
    return fromInstanceMetadata(init);
};

function memoizeChain(providers, treatAsExpired) {
    const chain = internalCreateChain(providers);
    let activeLock;
    let passiveLock;
    let credentials;
    let forceRefreshLock;
    const provider = async (options) => {
        if (options?.forceRefresh) {
            if (!forceRefreshLock) {
                forceRefreshLock = chain(options)
                    .then((c) => {
                    credentials = c;
                })
                    .finally(() => {
                    forceRefreshLock = undefined;
                });
            }
            await forceRefreshLock;
            return credentials;
        }
        if (credentials?.expiration) {
            if (credentials?.expiration?.getTime() < Date.now()) {
                credentials = undefined;
            }
        }
        if (activeLock) {
            await activeLock;
        }
        else if (!credentials || treatAsExpired?.(credentials)) {
            if (credentials) {
                if (!passiveLock) {
                    passiveLock = chain(options)
                        .then((c) => {
                        credentials = c;
                    })
                        .finally(() => {
                        passiveLock = undefined;
                    });
                }
            }
            else {
                activeLock = chain(options)
                    .then((c) => {
                    credentials = c;
                })
                    .finally(() => {
                    activeLock = undefined;
                });
                return provider(options);
            }
        }
        return credentials;
    };
    return provider;
}
const internalCreateChain = (providers) => async (awsIdentityProperties) => {
    let lastProviderError;
    for (const provider of providers) {
        try {
            return await provider(awsIdentityProperties);
        }
        catch (err) {
            lastProviderError = err;
            if (err?.tryNextLink) {
                continue;
            }
            throw err;
        }
    }
    throw lastProviderError;
};

let multipleCredentialSourceWarningEmitted = false;
const defaultProvider = (init = {}) => memoizeChain([
    async () => {
        const profile = init.profile ?? process.env[ENV_PROFILE];
        if (profile) {
            const envStaticCredentialsAreSet = process.env[ENV_KEY] && process.env[ENV_SECRET];
            if (envStaticCredentialsAreSet) {
                if (!multipleCredentialSourceWarningEmitted) {
                    const warnFn = init.logger?.warn && init.logger?.constructor?.name !== "NoOpLogger"
                        ? init.logger.warn.bind(init.logger)
                        : console.warn;
                    warnFn(`@aws-sdk/credential-provider-node - defaultProvider::fromEnv WARNING:
    Multiple credential sources detected: 
    Both AWS_PROFILE and the pair AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY static credentials are set.
    This SDK will proceed with the AWS_PROFILE value.
    
    However, a future version may change this behavior to prefer the ENV static credentials.
    Please ensure that your environment only sets either the AWS_PROFILE or the
    AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY pair.
`);
                    multipleCredentialSourceWarningEmitted = true;
                }
            }
            throw new CredentialsProviderError("AWS_PROFILE is set, skipping fromEnv provider.", {
                logger: init.logger,
                tryNextLink: true,
            });
        }
        init.logger?.debug("@aws-sdk/credential-provider-node - defaultProvider::fromEnv");
        return fromEnv(init)();
    },
    async (awsIdentityProperties) => {
        init.logger?.debug("@aws-sdk/credential-provider-node - defaultProvider::fromSSO");
        const { ssoStartUrl, ssoAccountId, ssoRegion, ssoRoleName, ssoSession } = init;
        if (!ssoStartUrl && !ssoAccountId && !ssoRegion && !ssoRoleName && !ssoSession) {
            throw new CredentialsProviderError("Skipping SSO provider in default chain (inputs do not include SSO fields).", { logger: init.logger });
        }
        const { fromSSO } = require('@aws-sdk/credential-provider-sso');
        return fromSSO(init)(awsIdentityProperties);
    },
    async (awsIdentityProperties) => {
        init.logger?.debug("@aws-sdk/credential-provider-node - defaultProvider::fromIni");
        const { fromIni } = require('@aws-sdk/credential-provider-ini');
        return fromIni(init)(awsIdentityProperties);
    },
    async (awsIdentityProperties) => {
        init.logger?.debug("@aws-sdk/credential-provider-node - defaultProvider::fromProcess");
        const { fromProcess } = require('@aws-sdk/credential-provider-process');
        return fromProcess(init)(awsIdentityProperties);
    },
    async (awsIdentityProperties) => {
        init.logger?.debug("@aws-sdk/credential-provider-node - defaultProvider::fromTokenFile");
        const { fromTokenFile } = require('@aws-sdk/credential-provider-web-identity');
        return fromTokenFile(init)(awsIdentityProperties);
    },
    async () => {
        init.logger?.debug("@aws-sdk/credential-provider-node - defaultProvider::remoteProvider");
        return (await remoteProvider(init))();
    },
    async () => {
        throw new CredentialsProviderError("Could not load credentials from any providers", {
            tryNextLink: false,
            logger: init.logger,
        });
    },
], credentialsTreatedAsExpired);
const credentialsWillNeedRefresh = (credentials) => credentials?.expiration !== undefined;
const credentialsTreatedAsExpired = (credentials) => credentials?.expiration !== undefined && credentials.expiration.getTime() - Date.now() < 300000;

exports.credentialsTreatedAsExpired = credentialsTreatedAsExpired;
exports.credentialsWillNeedRefresh = credentialsWillNeedRefresh;
exports.defaultProvider = defaultProvider;
