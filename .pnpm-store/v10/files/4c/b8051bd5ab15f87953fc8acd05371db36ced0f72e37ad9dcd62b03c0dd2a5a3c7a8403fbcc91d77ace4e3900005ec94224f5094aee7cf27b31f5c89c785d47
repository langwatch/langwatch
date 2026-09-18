const { ProviderError, booleanSelector, SelectorType, loadConfig } = require("@smithy/core/config");
const { setCredentialFeature } = require("@aws-sdk/core/client");
const { normalizeProvider, memoizeIdentityProvider, isIdentityExpired, doesIdentityRequireRefresh } = require("@smithy/core");
const { SignatureV4 } = require("@smithy/signature-v4");
const { HttpResponse, HttpRequest } = require("@smithy/core/protocols");

const getDateHeader = (response) => HttpResponse.isInstance(response) ? (response.headers?.date ?? response.headers?.Date) : undefined;
const getAgeHeader = (response) => HttpResponse.isInstance(response) ? (response.headers?.age ?? response.headers?.Age) : undefined;

const getSkewCorrectedDate = (systemClockOffset) => new Date(Date.now() + systemClockOffset);

const getUpdatedSystemClockOffset = (clockTime, currentSystemClockOffset, timeRequestSent, ageHeader) => {
    if (ageHeader !== undefined) {
        return currentSystemClockOffset;
    }
    const serverTime = Date.parse(clockTime);
    const timeResponseReceived = Date.now();
    if (timeRequestSent !== undefined && timeResponseReceived - timeRequestSent > 900_000) {
        return currentSystemClockOffset;
    }
    const candidateSkew = timeRequestSent !== undefined
        ? serverTime - (timeRequestSent + timeResponseReceived) / 2
        : serverTime - timeResponseReceived;
    return candidateSkew;
};

const throwSigningPropertyError = (name, property) => {
    if (!property) {
        throw new Error(`Property \`${name}\` is not resolved for AWS SDK SigV4Auth`);
    }
    return property;
};
const validateSigningProperties = async (signingProperties) => {
    const context = throwSigningPropertyError("context", signingProperties.context);
    const config = throwSigningPropertyError("config", signingProperties.config);
    const authScheme = context.endpointV2?.properties?.authSchemes?.[0];
    const signerFunction = throwSigningPropertyError("signer", config.signer);
    const signer = await signerFunction(authScheme);
    const signingRegion = signingProperties?.signingRegion;
    const signingRegionSet = signingProperties?.signingRegionSet;
    const signingName = signingProperties?.signingName;
    return {
        config,
        signer,
        signingRegion,
        signingRegionSet,
        signingName,
    };
};
class AwsSdkSigV4Signer {
    async sign(httpRequest, identity, signingProperties) {
        if (!HttpRequest.isInstance(httpRequest)) {
            throw new Error("The request is not an instance of `HttpRequest` and cannot be signed");
        }
        const validatedProps = await validateSigningProperties(signingProperties);
        const { config, signer } = validatedProps;
        let { signingRegion, signingName } = validatedProps;
        const handlerExecutionContext = signingProperties.context;
        if (handlerExecutionContext?.authSchemes?.length ?? 0 > 1) {
            const [first, second] = handlerExecutionContext.authSchemes;
            if (first?.name === "sigv4a" && second?.name === "sigv4") {
                signingRegion = second?.signingRegion ?? signingRegion;
                signingName = second?.signingName ?? signingName;
            }
        }
        const noSkewCorrection = (await config.disableClockSkewCorrection?.()) === true;
        signingProperties._disableClockSkewCorrection = noSkewCorrection;
        if (!noSkewCorrection) {
            signingProperties._preRequestSystemClockOffset = config.systemClockOffset;
            signingProperties._requestSentAt = Date.now();
        }
        const signedRequest = await signer.sign(httpRequest, {
            signingDate: noSkewCorrection ? new Date() : getSkewCorrectedDate(config.systemClockOffset),
            signingRegion: signingRegion,
            signingService: signingName,
        });
        return signedRequest;
    }
    errorHandler(signingProperties) {
        return (error) => {
            const errorException = error;
            if (!signingProperties._disableClockSkewCorrection) {
                const serverTime = errorException.ServerTime ?? getDateHeader(errorException.$response);
                if (serverTime) {
                    const config = throwSigningPropertyError("config", signingProperties.config);
                    const preRequestOffset = signingProperties._preRequestSystemClockOffset;
                    const timeRequestSent = signingProperties._requestSentAt;
                    const ageHeader = getAgeHeader(errorException.$response);
                    const newOffset = getUpdatedSystemClockOffset(serverTime, config.systemClockOffset, timeRequestSent, ageHeader);
                    config.systemClockOffset = newOffset;
                    const skewExceedsThreshold = Math.abs(newOffset) >= 240_000;
                    const isLocalCorrection = newOffset !== preRequestOffset;
                    const isConcurrentCorrection = preRequestOffset !== undefined && preRequestOffset !== newOffset;
                    if (skewExceedsThreshold && (isLocalCorrection || isConcurrentCorrection) && errorException.$metadata) {
                        errorException.$metadata.clockSkewCorrected = true;
                    }
                }
            }
            throw error;
        };
    }
    successHandler(httpResponse, signingProperties) {
        if (signingProperties._disableClockSkewCorrection) {
            return;
        }
        const dateHeader = getDateHeader(httpResponse);
        if (dateHeader) {
            const config = throwSigningPropertyError("config", signingProperties.config);
            const timeRequestSent = signingProperties._requestSentAt;
            const ageHeader = getAgeHeader(httpResponse);
            config.systemClockOffset = getUpdatedSystemClockOffset(dateHeader, config.systemClockOffset, timeRequestSent, ageHeader);
        }
    }
}
const AWSSDKSigV4Signer = AwsSdkSigV4Signer;

class AwsSdkSigV4ASigner extends AwsSdkSigV4Signer {
    async sign(httpRequest, identity, signingProperties) {
        if (!HttpRequest.isInstance(httpRequest)) {
            throw new Error("The request is not an instance of `HttpRequest` and cannot be signed");
        }
        const { config, signer, signingRegion, signingRegionSet, signingName } = await validateSigningProperties(signingProperties);
        const configResolvedSigningRegionSet = await config.sigv4aSigningRegionSet?.();
        const multiRegionOverride = (configResolvedSigningRegionSet ??
            signingRegionSet ?? [signingRegion]).join(",");
        const noSkewCorrection = (await config.disableClockSkewCorrection?.()) === true;
        signingProperties._disableClockSkewCorrection = noSkewCorrection;
        if (!noSkewCorrection) {
            signingProperties._preRequestSystemClockOffset = config.systemClockOffset;
            signingProperties._requestSentAt = Date.now();
        }
        const signedRequest = await signer.sign(httpRequest, {
            signingDate: noSkewCorrection ? new Date() : getSkewCorrectedDate(config.systemClockOffset),
            signingRegion: multiRegionOverride,
            signingService: signingName,
        });
        return signedRequest;
    }
}

const getArrayForCommaSeparatedString = (str) => typeof str === "string" && str.length > 0 ? str.split(",").map((item) => item.trim()) : [];

const getBearerTokenEnvKey = (signingName) => `AWS_BEARER_TOKEN_${signingName.replace(/[\s-]/g, "_").toUpperCase()}`;

const NODE_AUTH_SCHEME_PREFERENCE_ENV_KEY = "AWS_AUTH_SCHEME_PREFERENCE";
const NODE_AUTH_SCHEME_PREFERENCE_CONFIG_KEY = "auth_scheme_preference";
const NODE_AUTH_SCHEME_PREFERENCE_OPTIONS = {
    environmentVariableSelector: (env, options) => {
        if (options?.signingName) {
            const bearerTokenKey = getBearerTokenEnvKey(options.signingName);
            if (bearerTokenKey in env)
                return ["httpBearerAuth"];
        }
        if (!(NODE_AUTH_SCHEME_PREFERENCE_ENV_KEY in env))
            return undefined;
        return getArrayForCommaSeparatedString(env[NODE_AUTH_SCHEME_PREFERENCE_ENV_KEY]);
    },
    configFileSelector: (profile) => {
        if (!(NODE_AUTH_SCHEME_PREFERENCE_CONFIG_KEY in profile))
            return undefined;
        return getArrayForCommaSeparatedString(profile[NODE_AUTH_SCHEME_PREFERENCE_CONFIG_KEY]);
    },
    default: [],
};

const resolveAwsSdkSigV4AConfig = (config) => {
    config.sigv4aSigningRegionSet = normalizeProvider(config.sigv4aSigningRegionSet);
    return config;
};
const NODE_SIGV4A_CONFIG_OPTIONS = {
    environmentVariableSelector(env) {
        if (env.AWS_SIGV4A_SIGNING_REGION_SET) {
            return env.AWS_SIGV4A_SIGNING_REGION_SET.split(",").map((_) => _.trim());
        }
        throw new ProviderError("AWS_SIGV4A_SIGNING_REGION_SET not set in env.", {
            tryNextLink: true,
        });
    },
    configFileSelector(profile) {
        if (profile.sigv4a_signing_region_set) {
            return (profile.sigv4a_signing_region_set ?? "").split(",").map((_) => _.trim());
        }
        throw new ProviderError("sigv4a_signing_region_set not set in profile.", {
            tryNextLink: true,
        });
    },
    default: undefined,
};

const bindResolveAwsSdkSigV4Config = (defaultDisableClockSkewCorrection) => (config) => {
    let inputCredentials = config.credentials;
    let isUserSupplied = !!config.credentials;
    let resolvedCredentials = undefined;
    Object.defineProperty(config, "credentials", {
        set(credentials) {
            if (credentials && credentials !== inputCredentials && credentials !== resolvedCredentials) {
                isUserSupplied = true;
            }
            inputCredentials = credentials;
            const memoizedProvider = normalizeCredentialProvider(config, {
                credentials: inputCredentials,
                credentialDefaultProvider: config.credentialDefaultProvider,
            });
            const boundProvider = bindCallerConfig(config, memoizedProvider);
            if (isUserSupplied && !boundProvider.attributed) {
                const isCredentialObject = typeof inputCredentials === "object" && inputCredentials !== null;
                resolvedCredentials = async (options) => {
                    const creds = await boundProvider(options);
                    const attributedCreds = creds;
                    if (isCredentialObject && (!attributedCreds.$source || Object.keys(attributedCreds.$source).length === 0)) {
                        return setCredentialFeature(attributedCreds, "CREDENTIALS_CODE", "e");
                    }
                    return attributedCreds;
                };
                resolvedCredentials.memoized = boundProvider.memoized;
                resolvedCredentials.configBound = boundProvider.configBound;
                resolvedCredentials.attributed = true;
            }
            else {
                resolvedCredentials = boundProvider;
            }
        },
        get() {
            return resolvedCredentials;
        },
        enumerable: true,
        configurable: true,
    });
    config.credentials = inputCredentials;
    const { signingEscapePath = true, systemClockOffset = config.systemClockOffset || 0, sha256, } = config;
    let signer;
    if (config.signer) {
        signer = normalizeProvider(config.signer);
    }
    else if (config.regionInfoProvider) {
        signer = () => normalizeProvider(config.region)()
            .then(async (region) => [
            (await config.regionInfoProvider(region, {
                useFipsEndpoint: await config.useFipsEndpoint(),
                useDualstackEndpoint: await config.useDualstackEndpoint(),
            })) || {},
            region,
        ])
            .then(([regionInfo, region]) => {
            const { signingRegion, signingService } = regionInfo;
            config.signingRegion = config.signingRegion || signingRegion || region;
            config.signingName = config.signingName || signingService || config.serviceId;
            const params = {
                ...config,
                credentials: config.credentials,
                region: config.signingRegion,
                service: config.signingName,
                sha256,
                uriEscapePath: signingEscapePath,
            };
            const SignerCtor = config.signerConstructor || SignatureV4;
            return new SignerCtor(params);
        });
    }
    else {
        signer = async (authScheme) => {
            authScheme = Object.assign({}, {
                name: "sigv4",
                signingName: config.signingName || config.defaultSigningName,
                signingRegion: await normalizeProvider(config.region)(),
                properties: {},
            }, authScheme);
            const signingRegion = authScheme.signingRegion;
            const signingService = authScheme.signingName;
            config.signingRegion = config.signingRegion || signingRegion;
            config.signingName = config.signingName || signingService || config.serviceId;
            const params = {
                ...config,
                credentials: config.credentials,
                region: config.signingRegion,
                service: config.signingName,
                sha256,
                uriEscapePath: signingEscapePath,
            };
            const SignerCtor = config.signerConstructor || SignatureV4;
            return new SignerCtor(params);
        };
    }
    const resolvedConfig = Object.assign(config, {
        systemClockOffset,
        signingEscapePath,
        signer,
        disableClockSkewCorrection: normalizeProvider(config.disableClockSkewCorrection ?? defaultDisableClockSkewCorrection),
    });
    return resolvedConfig;
};
function normalizeCredentialProvider(config, { credentials, credentialDefaultProvider }) {
    let credentialsProvider;
    if (credentials) {
        if (!credentials?.memoized) {
            credentialsProvider = memoizeIdentityProvider(credentials, isIdentityExpired, doesIdentityRequireRefresh);
        }
        else {
            credentialsProvider = credentials;
        }
    }
    else {
        if (credentialDefaultProvider) {
            credentialsProvider = normalizeProvider(credentialDefaultProvider(Object.assign({}, config, {
                parentClientConfig: config,
            })));
        }
        else {
            credentialsProvider = async () => {
                throw new Error("@aws-sdk/core::resolveAwsSdkSigV4Config - `credentials` not provided and no credentialDefaultProvider was configured.");
            };
        }
    }
    credentialsProvider.memoized = true;
    return credentialsProvider;
}
function bindCallerConfig(config, credentialsProvider) {
    if (credentialsProvider.configBound) {
        return credentialsProvider;
    }
    const fn = async (options) => credentialsProvider({ ...options, callerClientConfig: config });
    fn.memoized = credentialsProvider.memoized;
    fn.configBound = true;
    return fn;
}

const ENV_DISABLE_CLOCK_SKEW_CORRECTION = "AWS_DISABLE_CLOCK_SKEW_CORRECTION";
const CONFIG_DISABLE_CLOCK_SKEW_CORRECTION = "disable_clock_skew_correction";
const NODE_DISABLE_CLOCK_SKEW_CORRECTION_CONFIG_OPTIONS = {
    environmentVariableSelector: (env) => booleanSelector(env, ENV_DISABLE_CLOCK_SKEW_CORRECTION, SelectorType.ENV),
    configFileSelector: (profile) => booleanSelector(profile, CONFIG_DISABLE_CLOCK_SKEW_CORRECTION, SelectorType.CONFIG),
    default: false,
};

const DEFAULT_DISABLE_CLOCK_SKEW_CORRECTION = loadConfig(NODE_DISABLE_CLOCK_SKEW_CORRECTION_CONFIG_OPTIONS);

const resolveAwsSdkSigV4Config = bindResolveAwsSdkSigV4Config(DEFAULT_DISABLE_CLOCK_SKEW_CORRECTION);
const resolveAWSSDKSigV4Config = resolveAwsSdkSigV4Config;

exports.AWSSDKSigV4Signer = AWSSDKSigV4Signer;
exports.AwsSdkSigV4ASigner = AwsSdkSigV4ASigner;
exports.AwsSdkSigV4Signer = AwsSdkSigV4Signer;
exports.NODE_AUTH_SCHEME_PREFERENCE_OPTIONS = NODE_AUTH_SCHEME_PREFERENCE_OPTIONS;
exports.NODE_SIGV4A_CONFIG_OPTIONS = NODE_SIGV4A_CONFIG_OPTIONS;
exports.getBearerTokenEnvKey = getBearerTokenEnvKey;
exports.resolveAWSSDKSigV4Config = resolveAWSSDKSigV4Config;
exports.resolveAwsSdkSigV4AConfig = resolveAwsSdkSigV4AConfig;
exports.resolveAwsSdkSigV4Config = resolveAwsSdkSigV4Config;
exports.validateSigningProperties = validateSigningProperties;
