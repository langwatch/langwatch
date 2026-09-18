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
const { AwsRestJsonProtocol } = require("@aws-sdk/core/protocols");
const { Sha256 } = require("@smithy/core/checksum");

const defaultSigninHttpAuthSchemeParametersProvider = async (config, context, input) => {
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
            name: "signin",
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
const defaultSigninHttpAuthSchemeProvider = (authParameters) => {
    const options = [];
    switch (authParameters.operation) {
        case "CreateOAuth2Token":
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
        defaultSigningName: "signin",
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

const s = "ref";
const a = -1, b = false, c = true, d = "isSet", e = "booleanEquals", f = "coalesce", g = "PartitionResult", h = "stringEquals", i = "getAttr", j = "https://signin.{Region}.{PartitionResult#dualStackDnsSuffix}", k = { [s]: "Endpoint" }, l = { "fn": i, "argv": [{ [s]: g }, "name"] }, m = { [s]: "Region" }, n = { [s]: g }, o = { "authSchemes": [{ "name": "sigv4", "signingName": "signin", "signingRegion": "{Region}" }] }, p = {}, q = [m];
const _data = {
    conditions: [
        [d, q],
        [e, [{ fn: f, argv: [{ [s]: "IsControlPlane" }, b] }, c]],
        [d, [k]],
        ["aws.partition", q, g],
        [e, [{ [s]: "UseFIPS" }, c]],
        [h, [l, "aws"]],
        [e, [{ fn: f, argv: [{ [s]: "IsOAuthEndpoint" }, b] }, c]],
        [e, [{ [s]: "UseDualStack" }, c]],
        [h, [l, "aws-cn"]],
        [h, [m, "us-gov-west-1"]],
        [h, [l, "aws-us-gov"]],
        [e, [{ fn: i, argv: [n, "supportsFIPS"] }, c]],
        [h, [l, "aws-iso"]],
        [h, [l, "aws-iso-b"]],
        [h, [l, "aws-iso-f"]],
        [h, [l, "aws-iso-e"]],
        [h, [l, "aws-eusc"]],
        [e, [{ fn: i, argv: [n, "supportsDualStack"] }, c]]
    ],
    results: [
        [a],
        ["https://signin.{Region}.api.aws", o],
        ["https://signin.{Region}.api.amazonwebservices.com.cn", o],
        [j, o],
        [a, "FIPS endpoints are not supported for OAuth operations. Disable FIPS or use a non-OAuth operation."],
        ["https://{Region}.oauth.signin.aws", o],
        ["https://{Region}.signin.aws.amazon.com", p],
        ["https://{Region}.signin.amazonaws.cn", p],
        ["https://{Region}.signin.amazonaws-us-gov.com", p],
        ["https://{Region}.signin.c2shome.ic.gov", p],
        ["https://{Region}.signin.sc2shome.sgov.gov", p],
        ["https://{Region}.signin.csphome.hci.ic.gov", p],
        ["https://{Region}.signin.csphome.adc-e.uk", p],
        ["https://{Region}.signin.amazonaws-eusc.eu", p],
        ["https://signin-fips.amazonaws-us-gov.com", p],
        ["https://{Region}.signin-fips.amazonaws-us-gov.com", p],
        ["https://{Region}.signin.{PartitionResult#dnsSuffix}", p],
        [a, "Invalid Configuration: FIPS and custom endpoint are not supported"],
        [a, "Invalid Configuration: Dualstack and custom endpoint are not supported"],
        [k, p],
        ["https://signin-fips.{Region}.{PartitionResult#dualStackDnsSuffix}", p],
        [a, "FIPS and DualStack are enabled, but this partition does not support one or both"],
        ["https://signin-fips.{Region}.{PartitionResult#dnsSuffix}", p],
        [a, "FIPS is enabled but this partition does not support FIPS"],
        [j, p],
        [a, "DualStack is enabled but this partition does not support DualStack"],
        ["https://signin.{Region}.{PartitionResult#dnsSuffix}", p],
        [a, "Invalid Configuration: Missing Region"]
    ]
};
const root = 2;
const r = 100_000_000;
const nodes = new Int32Array([
    -1, 1, -1,
    0, 6, 3,
    2, 36, 4,
    4, 5, r + 27,
    6, r + 4, r + 27,
    1, 29, 7,
    2, 36, 8,
    3, 9, 31,
    4, 22, 10,
    5, 19, 11,
    7, 21, 12,
    8, r + 7, 13,
    10, r + 8, 14,
    12, r + 9, 15,
    13, r + 10, 16,
    14, r + 11, 17,
    15, r + 12, 18,
    16, r + 13, r + 16,
    6, r + 5, 20,
    7, 21, r + 6,
    17, r + 24, r + 25,
    6, r + 4, 23,
    7, 27, 24,
    9, r + 14, 25,
    10, r + 15, 26,
    11, r + 22, r + 23,
    11, 28, r + 21,
    17, r + 20, r + 21,
    2, 35, 30,
    3, 39, 31,
    4, 32, r + 27,
    6, r + 4, 33,
    7, r + 27, 34,
    9, r + 14, r + 27,
    3, 39, 36,
    4, 38, 37,
    7, r + 18, r + 19,
    6, r + 4, r + 17,
    5, r + 1, 40,
    8, r + 2, r + 3,
]);
const bdd = BinaryDecisionDiagram.from(nodes, root, _data.conditions, _data.results);

const cache = new EndpointCache({
    size: 50,
    params: ["Endpoint", "IsControlPlane", "IsOAuthEndpoint", "Region", "UseDualStack", "UseFIPS"],
});
const defaultEndpointResolver = (endpointParams, context = {}) => {
    return cache.get(endpointParams, () => decideEndpoint(bdd, {
        endpointParams: endpointParams,
        logger: context.logger,
    }));
};
customEndpointFunctions.aws = awsEndpointFunctions;

class SigninServiceException extends ServiceException {
    constructor(options) {
        super(options);
        Object.setPrototypeOf(this, SigninServiceException.prototype);
    }
}

class AccessDeniedException extends SigninServiceException {
    name = "AccessDeniedException";
    $fault = "client";
    error;
    constructor(opts) {
        super({
            name: "AccessDeniedException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, AccessDeniedException.prototype);
        this.error = opts.error;
    }
}
class InternalServerException extends SigninServiceException {
    name = "InternalServerException";
    $fault = "server";
    error;
    constructor(opts) {
        super({
            name: "InternalServerException",
            $fault: "server",
            ...opts,
        });
        Object.setPrototypeOf(this, InternalServerException.prototype);
        this.error = opts.error;
    }
}
class TooManyRequestsError extends SigninServiceException {
    name = "TooManyRequestsError";
    $fault = "client";
    error;
    constructor(opts) {
        super({
            name: "TooManyRequestsError",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, TooManyRequestsError.prototype);
        this.error = opts.error;
    }
}
class ValidationException extends SigninServiceException {
    name = "ValidationException";
    $fault = "client";
    error;
    constructor(opts) {
        super({
            name: "ValidationException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ValidationException.prototype);
        this.error = opts.error;
    }
}

const _ADE = "AccessDeniedException";
const _AT = "AccessToken";
const _COAT = "CreateOAuth2Token";
const _COATR = "CreateOAuth2TokenRequest";
const _COATRB = "CreateOAuth2TokenRequestBody";
const _COATRBr = "CreateOAuth2TokenResponseBody";
const _COATRr = "CreateOAuth2TokenResponse";
const _COATWIAM = "CreateOAuth2TokenWithIAM";
const _COATWIAMR = "CreateOAuth2TokenWithIAMRequest";
const _COATWIAMRr = "CreateOAuth2TokenWithIAMResponse";
const _ISE = "InternalServerException";
const _OAAT = "OAuthAccessToken";
const _RT = "RefreshToken";
const _TMRE = "TooManyRequestsError";
const _VE = "ValidationException";
const _aKI = "accessKeyId";
const _aT = "accessToken";
const _at = "access_token";
const _c = "client";
const _cI = "clientId";
const _cV = "codeVerifier";
const _co = "code";
const _e = "error";
const _eI = "expiresIn";
const _ei = "expires_in";
const _gT = "grantType";
const _gt = "grant_type";
const _h = "http";
const _hE = "httpError";
const _iT = "idToken";
const _jN = "jsonName";
const _m = "message";
const _r = "resource";
const _rT = "refreshToken";
const _rU = "redirectUri";
const _s = "smithy.ts.sdk.synthetic.com.amazonaws.signin";
const _sAK = "secretAccessKey";
const _sT = "sessionToken";
const _se = "server";
const _tI = "tokenInput";
const _tO = "tokenOutput";
const _tT = "tokenType";
const _tt = "token_type";
const n0 = "com.amazonaws.signin";
const _s_registry = TypeRegistry.for(_s);
var SigninServiceException$ = [-3, _s, "SigninServiceException", 0, [], []];
_s_registry.registerError(SigninServiceException$, SigninServiceException);
const n0_registry = TypeRegistry.for(n0);
var AccessDeniedException$ = [-3, n0, _ADE,
    { [_e]: _c },
    [_e, _m],
    [0, 0], 2
];
n0_registry.registerError(AccessDeniedException$, AccessDeniedException);
var InternalServerException$ = [-3, n0, _ISE,
    { [_e]: _se, [_hE]: 500 },
    [_e, _m],
    [0, 0], 2
];
n0_registry.registerError(InternalServerException$, InternalServerException);
var TooManyRequestsError$ = [-3, n0, _TMRE,
    { [_e]: _c, [_hE]: 429 },
    [_e, _m],
    [0, 0], 2
];
n0_registry.registerError(TooManyRequestsError$, TooManyRequestsError);
var ValidationException$ = [-3, n0, _VE,
    { [_e]: _c, [_hE]: 400 },
    [_e, _m],
    [0, 0], 2
];
n0_registry.registerError(ValidationException$, ValidationException);
const errorTypeRegistries = [
    _s_registry,
    n0_registry,
];
var OAuthAccessToken = [0, n0, _OAAT, 8, 0];
var RefreshToken = [0, n0, _RT, 8, 0];
var AccessToken$ = [3, n0, _AT,
    8,
    [_aKI, _sAK, _sT],
    [[0, { [_jN]: _aKI }], [0, { [_jN]: _sAK }], [0, { [_jN]: _sT }]], 3
];
var CreateOAuth2TokenRequest$ = [3, n0, _COATR,
    0,
    [_tI],
    [[() => CreateOAuth2TokenRequestBody$, 16]], 1
];
var CreateOAuth2TokenRequestBody$ = [3, n0, _COATRB,
    0,
    [_cI, _gT, _co, _rU, _cV, _rT],
    [[0, { [_jN]: _cI }], [0, { [_jN]: _gT }], 0, [0, { [_jN]: _rU }], [0, { [_jN]: _cV }], [() => RefreshToken, { [_jN]: _rT }]], 2
];
var CreateOAuth2TokenResponse$ = [3, n0, _COATRr,
    0,
    [_tO],
    [[() => CreateOAuth2TokenResponseBody$, 16]], 1
];
var CreateOAuth2TokenResponseBody$ = [3, n0, _COATRBr,
    0,
    [_aT, _tT, _eI, _rT, _iT],
    [[() => AccessToken$, { [_jN]: _aT }], [0, { [_jN]: _tT }], [1, { [_jN]: _eI }], [() => RefreshToken, { [_jN]: _rT }], [0, { [_jN]: _iT }]], 4
];
var CreateOAuth2TokenWithIAMRequest$ = [3, n0, _COATWIAMR,
    0,
    [_gT, _r],
    [[0, { [_jN]: _gt }], 0], 2
];
var CreateOAuth2TokenWithIAMResponse$ = [3, n0, _COATWIAMRr,
    0,
    [_aT, _tT, _eI],
    [[() => OAuthAccessToken, { [_jN]: _at }], [0, { [_jN]: _tt }], [1, { [_jN]: _ei }]], 3
];
var CreateOAuth2Token$ = [9, n0, _COAT,
    { [_h]: ["POST", "/v1/token", 200] }, () => CreateOAuth2TokenRequest$, () => CreateOAuth2TokenResponse$
];
var CreateOAuth2TokenWithIAM$ = [9, n0, _COATWIAM,
    { [_h]: ["POST", "/v1/token?x-amz-client-auth-method=iam", 200] }, () => CreateOAuth2TokenWithIAMRequest$, () => CreateOAuth2TokenWithIAMResponse$
];

const getRuntimeConfig$1 = (config) => {
    return {
        apiVersion: "2023-01-01",
        base64Decoder: config?.base64Decoder ?? fromBase64,
        base64Encoder: config?.base64Encoder ?? toBase64,
        disableHostPrefix: config?.disableHostPrefix ?? false,
        endpointProvider: config?.endpointProvider ?? defaultEndpointResolver,
        extensions: config?.extensions ?? [],
        httpAuthSchemeProvider: config?.httpAuthSchemeProvider ?? defaultSigninHttpAuthSchemeProvider,
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
        protocol: config?.protocol ?? AwsRestJsonProtocol,
        protocolSettings: config?.protocolSettings ?? {
            defaultNamespace: "com.amazonaws.signin",
            errorTypeRegistries,
            version: "2023-01-01",
            serviceTarget: "Signin",
        },
        serviceId: config?.serviceId ?? "Signin",
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

class SigninClient extends Client {
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
            httpAuthSchemeParametersProvider: defaultSigninHttpAuthSchemeParametersProvider,
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

const command = makeBuilder(commonParams, "Signin", "SigninClient", getEndpointPlugin);
const _ep0 = {
    IsControlPlane: { type: "staticContextParams", value: false },
};
const _ep1 = {
    IsOAuthEndpoint: { type: "staticContextParams", value: true },
};
const _mw0 = (Command, cs, config, o) => [];

class CreateOAuth2TokenCommand extends command(_ep0, _mw0, "CreateOAuth2Token", CreateOAuth2Token$) {
}

class CreateOAuth2TokenWithIAMCommand extends command(_ep1, _mw0, "CreateOAuth2TokenWithIAM", CreateOAuth2TokenWithIAM$) {
}

const commands = {
    CreateOAuth2TokenCommand,
    CreateOAuth2TokenWithIAMCommand,
};
class Signin extends SigninClient {
}
createAggregatedClient(commands, Signin);

const OAuth2ErrorCode = {
    AUTHCODE_EXPIRED: "AUTHCODE_EXPIRED",
    CONFLICT: "CONFLICT",
    INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
    INVALID_REQUEST: "INVALID_REQUEST",
    RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
    SERVER_ERROR: "server_error",
    SERVICE_QUOTA_EXCEEDED: "SERVICE_QUOTA_EXCEEDED",
    TOKEN_EXPIRED: "TOKEN_EXPIRED",
    USER_CREDENTIALS_CHANGED: "USER_CREDENTIALS_CHANGED",
};

exports.AccessDeniedException = AccessDeniedException;
exports.AccessDeniedException$ = AccessDeniedException$;
exports.AccessToken$ = AccessToken$;
exports.CreateOAuth2Token$ = CreateOAuth2Token$;
exports.CreateOAuth2TokenCommand = CreateOAuth2TokenCommand;
exports.CreateOAuth2TokenRequest$ = CreateOAuth2TokenRequest$;
exports.CreateOAuth2TokenRequestBody$ = CreateOAuth2TokenRequestBody$;
exports.CreateOAuth2TokenResponse$ = CreateOAuth2TokenResponse$;
exports.CreateOAuth2TokenResponseBody$ = CreateOAuth2TokenResponseBody$;
exports.CreateOAuth2TokenWithIAM$ = CreateOAuth2TokenWithIAM$;
exports.CreateOAuth2TokenWithIAMCommand = CreateOAuth2TokenWithIAMCommand;
exports.CreateOAuth2TokenWithIAMRequest$ = CreateOAuth2TokenWithIAMRequest$;
exports.CreateOAuth2TokenWithIAMResponse$ = CreateOAuth2TokenWithIAMResponse$;
exports.InternalServerException = InternalServerException;
exports.InternalServerException$ = InternalServerException$;
exports.OAuth2ErrorCode = OAuth2ErrorCode;
exports.Signin = Signin;
exports.SigninClient = SigninClient;
exports.SigninServiceException = SigninServiceException;
exports.SigninServiceException$ = SigninServiceException$;
exports.TooManyRequestsError = TooManyRequestsError;
exports.TooManyRequestsError$ = TooManyRequestsError$;
exports.ValidationException = ValidationException;
exports.ValidationException$ = ValidationException$;
exports.errorTypeRegistries = errorTypeRegistries;
