export function memoizeChain(providers, treatAsExpired) {
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
export const internalCreateChain = (providers) => async (awsIdentityProperties) => {
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
