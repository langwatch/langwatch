const { awsEndpointFunctions, emitWarningIfUnsupportedVersion: emitWarningIfUnsupportedVersion$1, createDefaultUserAgentProvider, NODE_APP_ID_CONFIG_OPTIONS, getAwsRegionExtensionConfiguration, resolveAwsRegionExtensionConfiguration, resolveUserAgentConfig, resolveHostHeaderConfig, getUserAgentPlugin, getHostHeaderPlugin, getLoggerPlugin, getRecursionDetectionPlugin } = require("@aws-sdk/core/client");
const { NoAuthSigner, getHttpAuthSchemeEndpointRuleSetPlugin, DefaultIdentityProviderConfig, getHttpSigningPlugin } = require("@smithy/core");
const { normalizeProvider, getSmithyContext, ServiceException, NoOpLogger, emitWarningIfUnsupportedVersion, loadConfigsForDefaultMode, getDefaultExtensionConfiguration, resolveDefaultRuntimeConfig, Client, makeBuilder, createAggregatedClient } = require("@smithy/core/client");
const { Command: $Command } = require("@smithy/core/client");
exports.$Command = $Command;
exports.__Client = Client;
const { resolveDefaultsModeConfig, loadConfig, NODE_USE_FIPS_ENDPOINT_CONFIG_OPTIONS, NODE_USE_DUALSTACK_ENDPOINT_CONFIG_OPTIONS, NODE_REGION_CONFIG_OPTIONS, NODE_REGION_CONFIG_FILE_OPTIONS, resolveRegionConfig } = require("@smithy/core/config");
const { BinaryDecisionDiagram, EndpointCache, decideEndpoint, customEndpointFunctions, resolveEndpointConfig, getEndpointPlugin } = require("@smithy/core/endpoints");
const { parseUrl, getHttpHandlerExtensionConfiguration, resolveHttpHandlerRuntimeConfig, getContentLengthPlugin } = require("@smithy/core/protocols");
const { DEFAULT_RETRY_MODE, NODE_RETRY_MODE_CONFIG_OPTIONS, NODE_MAX_ATTEMPT_CONFIG_OPTIONS, resolveRetryConfig, getRetryPlugin } = require("@smithy/core/retry");
const { TypeRegistry, getSchemaSerdePlugin } = require("@smithy/core/schema");
const { resolveAwsSdkSigV4Config, AwsSdkSigV4Signer, NODE_AUTH_SCHEME_PREFERENCE_OPTIONS } = require("@aws-sdk/core/httpAuthSchemes");
const { toUtf8, fromUtf8, toBase64, fromBase64, calculateBodyLength } = require("@smithy/core/serde");
const { streamCollector, NodeHttpHandler } = require("@smithy/node-http-handler");
const { AwsJson1_1Protocol } = require("@aws-sdk/core/protocols");
const { Sha256 } = require("@smithy/core/checksum");

const defaultCognitoIdentityHttpAuthSchemeParametersProvider = async (config, context, input) => {
    return {
        operation: getSmithyContext(context).operation,
        region: await normalizeProvider(config.region)() || (() => {
            throw new Error("expected `region` to be configured for `aws.auth#sigv4`");
        })(),
    };
};
function createAwsAuthSigv4HttpAuthOption(authParameters) {
    return {
        schemeId: "aws.auth#sigv4",
        signingProperties: {
            name: "cognito-identity",
            region: authParameters.region,
        },
        propertiesExtractor: (config, context) => ({
            signingProperties: {
                config,
                context,
            },
        }),
    };
}
function createSmithyApiNoAuthHttpAuthOption(authParameters) {
    return {
        schemeId: "smithy.api#noAuth",
    };
}
const defaultCognitoIdentityHttpAuthSchemeProvider = (authParameters) => {
    const options = [];
    switch (authParameters.operation) {
        case "GetCredentialsForIdentity":
            {
                options.push(createSmithyApiNoAuthHttpAuthOption());
                break;
            }
        case "GetId":
            {
                options.push(createSmithyApiNoAuthHttpAuthOption());
                break;
            }
        default: {
            options.push(createAwsAuthSigv4HttpAuthOption(authParameters));
        }
    }
    return options;
};
const resolveHttpAuthSchemeConfig = (config) => {
    const config_0 = resolveAwsSdkSigV4Config(config);
    return Object.assign(config_0, {
        authSchemePreference: normalizeProvider(config.authSchemePreference ?? []),
    });
};

const resolveClientEndpointParameters = (options) => {
    return Object.assign(options, {
        useDualstackEndpoint: options.useDualstackEndpoint ?? false,
        useFipsEndpoint: options.useFipsEndpoint ?? false,
        defaultSigningName: "cognito-identity",
    });
};
const commonParams = {
    UseFIPS: { type: "builtInParams", name: "useFipsEndpoint" },
    Endpoint: { type: "builtInParams", name: "endpoint" },
    Region: { type: "builtInParams", name: "region" },
    UseDualStack: { type: "builtInParams", name: "useDualstackEndpoint" },
};

var version = "3.997.41";
var packageInfo = {
	version: version};

const m = "ref";
const a = -1, b = true, c = "isSet", d = "PartitionResult", e = "booleanEquals", f = "getAttr", g = "stringEquals", h = { [m]: "Endpoint" }, i = { [m]: d }, j = { [m]: "Region" }, k = {}, l = [j];
const _data = {
    conditions: [
        [c, [h]],
        [c, l],
        ["aws.partition", l, d],
        [e, [{ [m]: "UseFIPS" }, b]],
        [e, [{ fn: f, argv: [i, "supportsFIPS"] }, b]],
        [e, [{ [m]: "UseDualStack" }, b]],
        [e, [{ fn: f, argv: [i, "supportsDualStack"] }, b]],
        [g, [{ fn: f, argv: [i, "name"] }, "aws"]],
        [g, [j, "us-east-1"]],
        [g, [j, "us-east-2"]],
        [g, [j, "us-west-1"]],
        [g, [j, "us-west-2"]]
    ],
    results: [
        [a],
        [a, "Invalid Configuration: FIPS and custom endpoint are not supported"],
        [a, "Invalid Configuration: Dualstack and custom endpoint are not supported"],
        [h, k],
        ["https://cognito-identity-fips.us-east-1.amazonaws.com", k],
        ["https://cognito-identity-fips.us-east-2.amazonaws.com", k],
        ["https://cognito-identity-fips.us-west-1.amazonaws.com", k],
        ["https://cognito-identity-fips.us-west-2.amazonaws.com", k],
        ["https://cognito-identity-fips.{Region}.{PartitionResult#dualStackDnsSuffix}", k],
        [a, "FIPS and DualStack are enabled, but this partition does not support one or both"],
        ["https://cognito-identity-fips.{Region}.{PartitionResult#dnsSuffix}", k],
        [a, "FIPS is enabled but this partition does not support FIPS"],
        ["https://cognito-identity.{Region}.amazonaws.com", k],
        ["https://cognito-identity.{Region}.{PartitionResult#dualStackDnsSuffix}", k],
        [a, "DualStack is enabled but this partition does not support DualStack"],
        ["https://cognito-identity.{Region}.{PartitionResult#dnsSuffix}", k],
        [a, "Invalid Configuration: Missing Region"]
    ]
};
const root = 2;
const r = 100_000_000;
const nodes = new Int32Array([
    -1, 1, -1,
    0, 17, 3,
    1, 4, r + 16,
    2, 5, r + 16,
    3, 9, 6,
    5, 7, r + 15,
    6, 8, r + 14,
    7, r + 12, r + 13,
    4, 11, 10,
    5, r + 9, r + 11,
    5, 12, r + 10,
    6, 13, r + 9,
    8, r + 4, 14,
    9, r + 5, 15,
    10, r + 6, 16,
    11, r + 7, r + 8,
    3, r + 1, 18,
    5, r + 2, r + 3,
]);
const bdd = BinaryDecisionDiagram.from(nodes, root, _data.conditions, _data.results);

const cache = new EndpointCache({
    size: 50,
    params: ["Endpoint", "Region", "UseDualStack", "UseFIPS"],
});
const defaultEndpointResolver = (endpointParams, context = {}) => {
    return cache.get(endpointParams, () => decideEndpoint(bdd, {
        endpointParams: endpointParams,
        logger: context.logger,
    }));
};
customEndpointFunctions.aws = awsEndpointFunctions;

class CognitoIdentityServiceException extends ServiceException {
    constructor(options) {
        super(options);
        Object.setPrototypeOf(this, CognitoIdentityServiceException.prototype);
    }
}

class ExternalServiceException extends CognitoIdentityServiceException {
    name = "ExternalServiceException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ExternalServiceException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ExternalServiceException.prototype);
    }
}
class InternalErrorException extends CognitoIdentityServiceException {
    name = "InternalErrorException";
    $fault = "server";
    constructor(opts) {
        super({
            name: "InternalErrorException",
            $fault: "server",
            ...opts,
        });
        Object.setPrototypeOf(this, InternalErrorException.prototype);
    }
}
class InvalidIdentityPoolConfigurationException extends CognitoIdentityServiceException {
    name = "InvalidIdentityPoolConfigurationException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "InvalidIdentityPoolConfigurationException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidIdentityPoolConfigurationException.prototype);
    }
}
class InvalidParameterException extends CognitoIdentityServiceException {
    name = "InvalidParameterException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "InvalidParameterException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidParameterException.prototype);
    }
}
class NotAuthorizedException extends CognitoIdentityServiceException {
    name = "NotAuthorizedException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "NotAuthorizedException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, NotAuthorizedException.prototype);
    }
}
class ResourceConflictException extends CognitoIdentityServiceException {
    name = "ResourceConflictException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ResourceConflictException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ResourceConflictException.prototype);
    }
}
class ResourceNotFoundException extends CognitoIdentityServiceException {
    name = "ResourceNotFoundException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ResourceNotFoundException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ResourceNotFoundException.prototype);
    }
}
class TooManyRequestsException extends CognitoIdentityServiceException {
    name = "TooManyRequestsException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "TooManyRequestsException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, TooManyRequestsException.prototype);
    }
}
class LimitExceededException extends CognitoIdentityServiceException {
    name = "LimitExceededException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "LimitExceededException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, LimitExceededException.prototype);
    }
}

const _AI = "AccountId";
const _AKI = "AccessKeyId";
const _C = "Credentials";
const _CRA = "CustomRoleArn";
const _E = "Expiration";
const _ESE = "ExternalServiceException";
const _GCFI = "GetCredentialsForIdentity";
const _GCFII = "GetCredentialsForIdentityInput";
const _GCFIR = "GetCredentialsForIdentityResponse";
const _GI = "GetId";
const _GII = "GetIdInput";
const _GIR = "GetIdResponse";
const _IEE = "InternalErrorException";
const _II = "IdentityId";
const _IIPCE = "InvalidIdentityPoolConfigurationException";
const _IPE = "InvalidParameterException";
const _IPI = "IdentityPoolId";
const _IPT = "IdentityProviderToken";
const _L = "Logins";
const _LEE = "LimitExceededException";
const _LM = "LoginsMap";
const _NAE = "NotAuthorizedException";
const _RCE = "ResourceConflictException";
const _RNFE = "ResourceNotFoundException";
const _SK = "SecretKey";
const _SKS = "SecretKeyString";
const _ST = "SessionToken";
const _TMRE = "TooManyRequestsException";
const _c = "client";
const _e = "error";
const _hE = "httpError";
const _m = "message";
const _s = "smithy.ts.sdk.synthetic.com.amazonaws.cognitoidentity";
const _se = "server";
const n0 = "com.amazonaws.cognitoidentity";
const _s_registry = TypeRegistry.for(_s);
var CognitoIdentityServiceException$ = [-3, _s, "CognitoIdentityServiceException", 0, [], []];
_s_registry.registerError(CognitoIdentityServiceException$, CognitoIdentityServiceException);
const n0_registry = TypeRegistry.for(n0);
var ExternalServiceException$ = [-3, n0, _ESE,
    { [_e]: _c, [_hE]: 400 },
    [_m],
    [0]
];
n0_registry.registerError(ExternalServiceException$, ExternalServiceException);
var InternalErrorException$ = [-3, n0, _IEE,
    { [_e]: _se },
    [_m],
    [0]
];
n0_registry.registerError(InternalErrorException$, InternalErrorException);
var InvalidIdentityPoolConfigurationException$ = [-3, n0, _IIPCE,
    { [_e]: _c, [_hE]: 400 },
    [_m],
    [0]
];
n0_registry.registerError(InvalidIdentityPoolConfigurationException$, InvalidIdentityPoolConfigurationException);
var InvalidParameterException$ = [-3, n0, _IPE,
    { [_e]: _c, [_hE]: 400 },
    [_m],
    [0]
];
n0_registry.registerError(InvalidParameterException$, InvalidParameterException);
var LimitExceededException$ = [-3, n0, _LEE,
    { [_e]: _c, [_hE]: 400 },
    [_m],
    [0]
];
n0_registry.registerError(LimitExceededException$, LimitExceededException);
var NotAuthorizedException$ = [-3, n0, _NAE,
    { [_e]: _c, [_hE]: 403 },
    [_m],
    [0]
];
n0_registry.registerError(NotAuthorizedException$, NotAuthorizedException);
var ResourceConflictException$ = [-3, n0, _RCE,
    { [_e]: _c, [_hE]: 409 },
    [_m],
    [0]
];
n0_registry.registerError(ResourceConflictException$, ResourceConflictException);
var ResourceNotFoundException$ = [-3, n0, _RNFE,
    { [_e]: _c, [_hE]: 404 },
    [_m],
    [0]
];
n0_registry.registerError(ResourceNotFoundException$, ResourceNotFoundException);
var TooManyRequestsException$ = [-3, n0, _TMRE,
    { [_e]: _c, [_hE]: 429 },
    [_m],
    [0]
];
n0_registry.registerError(TooManyRequestsException$, TooManyRequestsException);
const errorTypeRegistries = [
    _s_registry,
    n0_registry,
];
var IdentityProviderToken = [0, n0, _IPT, 8, 0];
var SecretKeyString = [0, n0, _SKS, 8, 0];
var Credentials$ = [3, n0, _C,
    0,
    [_AKI, _SK, _ST, _E],
    [0, [() => SecretKeyString, 0], 0, 4]
];
var GetCredentialsForIdentityInput$ = [3, n0, _GCFII,
    0,
    [_II, _L, _CRA],
    [0, [() => LoginsMap, 0], 0], 1
];
var GetCredentialsForIdentityResponse$ = [3, n0, _GCFIR,
    0,
    [_II, _C],
    [0, [() => Credentials$, 0]]
];
var GetIdInput$ = [3, n0, _GII,
    0,
    [_IPI, _AI, _L],
    [0, 0, [() => LoginsMap, 0]], 1
];
var GetIdResponse$ = [3, n0, _GIR,
    0,
    [_II],
    [0]
];
var LoginsMap = [2, n0, _LM,
    0, [0,
        0],
    [() => IdentityProviderToken,
        0]
];
var GetCredentialsForIdentity$ = [9, n0, _GCFI,
    0, () => GetCredentialsForIdentityInput$, () => GetCredentialsForIdentityResponse$
];
var GetId$ = [9, n0, _GI,
    0, () => GetIdInput$, () => GetIdResponse$
];

const getRuntimeConfig$1 = (config) => {
    return {
        apiVersion: "2014-06-30",
        base64Decoder: config?.base64Decoder ?? fromBase64,
        base64Encoder: config?.base64Encoder ?? toBase64,
        disableHostPrefix: config?.disableHostPrefix ?? false,
        endpointProvider: config?.endpointProvider ?? defaultEndpointResolver,
        extensions: config?.extensions ?? [],
        httpAuthSchemeProvider: config?.httpAuthSchemeProvider ?? defaultCognitoIdentityHttpAuthSchemeProvider,
        httpAuthSchemes: config?.httpAuthSchemes ?? [
            {
                schemeId: "aws.auth#sigv4",
                identityProvider: (ipc) => ipc.getIdentityProvider("aws.auth#sigv4"),
                signer: new AwsSdkSigV4Signer(),
            },
            {
                schemeId: "smithy.api#noAuth",
                identityProvider: (ipc) => ipc.getIdentityProvider("smithy.api#noAuth") || (async () => ({})),
                signer: new NoAuthSigner(),
            },
        ],
        logger: config?.logger ?? new NoOpLogger(),
        protocol: config?.protocol ?? AwsJson1_1Protocol,
        protocolSettings: config?.protocolSettings ?? {
            defaultNamespace: "com.amazonaws.cognitoidentity",
            errorTypeRegistries,
            xmlNamespace: "http://cognito-identity.amazonaws.com/doc/2014-06-30/",
            version: "2014-06-30",
            serviceTarget: "AWSCognitoIdentityService",
        },
        serviceId: config?.serviceId ?? "Cognito Identity",
        sha256: config?.sha256 ?? Sha256,
        urlParser: config?.urlParser ?? parseUrl,
        utf8Decoder: config?.utf8Decoder ?? fromUtf8,
        utf8Encoder: config?.utf8Encoder ?? toUtf8,
    };
};

const getRuntimeConfig = (config) => {
    emitWarningIfUnsupportedVersion(process.version);
    const defaultsMode = resolveDefaultsModeConfig(config);
    const defaultConfigProvider = () => defaultsMode().then(loadConfigsForDefaultMode);
    const clientSharedValues = getRuntimeConfig$1(config);
    emitWarningIfUnsupportedVersion$1(process.version);
    const loaderConfig = {
        profile: config?.profile,
        logger: clientSharedValues.logger,
    };
    return {
        ...clientSharedValues,
        ...config,
        runtime: "node",
        defaultsMode,
        authSchemePreference: config?.authSchemePreference ?? loadConfig(NODE_AUTH_SCHEME_PREFERENCE_OPTIONS, loaderConfig),
        bodyLengthChecker: config?.bodyLengthChecker ?? calculateBodyLength,
        defaultUserAgentProvider: config?.defaultUserAgentProvider ?? createDefaultUserAgentProvider({ serviceId: clientSharedValues.serviceId, clientVersion: packageInfo.version }),
        maxAttempts: config?.maxAttempts ?? loadConfig(NODE_MAX_ATTEMPT_CONFIG_OPTIONS, config),
        region: config?.region ?? loadConfig(NODE_REGION_CONFIG_OPTIONS, { ...NODE_REGION_CONFIG_FILE_OPTIONS, ...loaderConfig }),
        requestHandler: NodeHttpHandler.create(config?.requestHandler ?? defaultConfigProvider),
        retryMode: config?.retryMode ??
            loadConfig({
                ...NODE_RETRY_MODE_CONFIG_OPTIONS,
                default: async () => (await defaultConfigProvider()).retryMode || DEFAULT_RETRY_MODE,
            }, config),
        streamCollector: config?.streamCollector ?? streamCollector,
        useDualstackEndpoint: config?.useDualstackEndpoint ?? loadConfig(NODE_USE_DUALSTACK_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
        useFipsEndpoint: config?.useFipsEndpoint ?? loadConfig(NODE_USE_FIPS_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
        userAgentAppId: config?.userAgentAppId ?? loadConfig(NODE_APP_ID_CONFIG_OPTIONS, loaderConfig),
    };
};

const getHttpAuthExtensionConfiguration = (runtimeConfig) => {
    const _httpAuthSchemes = runtimeConfig.httpAuthSchemes;
    let _httpAuthSchemeProvider = runtimeConfig.httpAuthSchemeProvider;
    let _credentials = runtimeConfig.credentials;
    return {
        setHttpAuthScheme(httpAuthScheme) {
            const index = _httpAuthSchemes.findIndex((scheme) => scheme.schemeId === httpAuthScheme.schemeId);
            if (index === -1) {
                _httpAuthSchemes.push(httpAuthScheme);
            }
            else {
                _httpAuthSchemes.splice(index, 1, httpAuthScheme);
            }
        },
        httpAuthSchemes() {
            return _httpAuthSchemes;
        },
        setHttpAuthSchemeProvider(httpAuthSchemeProvider) {
            _httpAuthSchemeProvider = httpAuthSchemeProvider;
        },
        httpAuthSchemeProvider() {
            return _httpAuthSchemeProvider;
        },
        setCredentials(credentials) {
            _credentials = credentials;
        },
        credentials() {
            return _credentials;
        },
    };
};
const resolveHttpAuthRuntimeConfig = (config) => {
    return {
        httpAuthSchemes: config.httpAuthSchemes(),
        httpAuthSchemeProvider: config.httpAuthSchemeProvider(),
        credentials: config.credentials(),
    };
};

const resolveRuntimeExtensions = (runtimeConfig, extensions) => {
    const extensionConfiguration = Object.assign(getAwsRegionExtensionConfiguration(runtimeConfig), getDefaultExtensionConfiguration(runtimeConfig), getHttpHandlerExtensionConfiguration(runtimeConfig), getHttpAuthExtensionConfiguration(runtimeConfig));
    extensions.forEach((extension) => extension.configure(extensionConfiguration));
    return Object.assign(runtimeConfig, resolveAwsRegionExtensionConfiguration(extensionConfiguration), resolveDefaultRuntimeConfig(extensionConfiguration), resolveHttpHandlerRuntimeConfig(extensionConfiguration), resolveHttpAuthRuntimeConfig(extensionConfiguration));
};

class CognitoIdentityClient extends Client {
    config;
    constructor(...[configuration]) {
        const _config_0 = getRuntimeConfig(configuration || {});
        super(_config_0);
        this.initConfig = _config_0;
        const _config_1 = resolveClientEndpointParameters(_config_0);
        const _config_2 = resolveUserAgentConfig(_config_1);
        const _config_3 = resolveRetryConfig(_config_2);
        const _config_4 = resolveRegionConfig(_config_3);
        const _config_5 = resolveHostHeaderConfig(_config_4);
        const _config_6 = resolveEndpointConfig(_config_5);
        const _config_7 = resolveHttpAuthSchemeConfig(_config_6);
        const _config_8 = resolveRuntimeExtensions(_config_7, configuration?.extensions || []);
        this.config = _config_8;
        this.middlewareStack.use(getSchemaSerdePlugin(this.config));
        this.middlewareStack.use(getUserAgentPlugin(this.config));
        this.middlewareStack.use(getRetryPlugin(this.config));
        this.middlewareStack.use(getContentLengthPlugin(this.config));
        this.middlewareStack.use(getHostHeaderPlugin(this.config));
        this.middlewareStack.use(getLoggerPlugin(this.config));
        this.middlewareStack.use(getRecursionDetectionPlugin(this.config));
        this.middlewareStack.use(getHttpAuthSchemeEndpointRuleSetPlugin(this.config, {
            httpAuthSchemeParametersProvider: defaultCognitoIdentityHttpAuthSchemeParametersProvider,
            identityProviderConfigProvider: async (config) => new DefaultIdentityProviderConfig({
                "aws.auth#sigv4": config.credentials,
            }),
        }));
        this.middlewareStack.use(getHttpSigningPlugin(this.config));
    }
    destroy() {
        super.destroy();
    }
}

const command = makeBuilder(commonParams, "AWSCognitoIdentityService", "CognitoIdentityClient", getEndpointPlugin);
const _ep0 = {};
const _mw0 = (Command, cs, config, o) => [];

class GetCredentialsForIdentityCommand extends command(_ep0, _mw0, "GetCredentialsForIdentity", GetCredentialsForIdentity$) {
}

class GetIdCommand extends command(_ep0, _mw0, "GetId", GetId$) {
}

const commands = {
    GetCredentialsForIdentityCommand,
    GetIdCommand,
};
class CognitoIdentity extends CognitoIdentityClient {
}
createAggregatedClient(commands, CognitoIdentity);

exports.CognitoIdentity = CognitoIdentity;
exports.CognitoIdentityClient = CognitoIdentityClient;
exports.CognitoIdentityServiceException = CognitoIdentityServiceException;
exports.CognitoIdentityServiceException$ = CognitoIdentityServiceException$;
exports.Credentials$ = Credentials$;
exports.ExternalServiceException = ExternalServiceException;
exports.ExternalServiceException$ = ExternalServiceException$;
exports.GetCredentialsForIdentity$ = GetCredentialsForIdentity$;
exports.GetCredentialsForIdentityCommand = GetCredentialsForIdentityCommand;
exports.GetCredentialsForIdentityInput$ = GetCredentialsForIdentityInput$;
exports.GetCredentialsForIdentityResponse$ = GetCredentialsForIdentityResponse$;
exports.GetId$ = GetId$;
exports.GetIdCommand = GetIdCommand;
exports.GetIdInput$ = GetIdInput$;
exports.GetIdResponse$ = GetIdResponse$;
exports.InternalErrorException = InternalErrorException;
exports.InternalErrorException$ = InternalErrorException$;
exports.InvalidIdentityPoolConfigurationException = InvalidIdentityPoolConfigurationException;
exports.InvalidIdentityPoolConfigurationException$ = InvalidIdentityPoolConfigurationException$;
exports.InvalidParameterException = InvalidParameterException;
exports.InvalidParameterException$ = InvalidParameterException$;
exports.LimitExceededException = LimitExceededException;
exports.LimitExceededException$ = LimitExceededException$;
exports.NotAuthorizedException = NotAuthorizedException;
exports.NotAuthorizedException$ = NotAuthorizedException$;
exports.ResourceConflictException = ResourceConflictException;
exports.ResourceConflictException$ = ResourceConflictException$;
exports.ResourceNotFoundException = ResourceNotFoundException;
exports.ResourceNotFoundException$ = ResourceNotFoundException$;
exports.TooManyRequestsException = TooManyRequestsException;
exports.TooManyRequestsException$ = TooManyRequestsException$;
exports.errorTypeRegistries = errorTypeRegistries;
