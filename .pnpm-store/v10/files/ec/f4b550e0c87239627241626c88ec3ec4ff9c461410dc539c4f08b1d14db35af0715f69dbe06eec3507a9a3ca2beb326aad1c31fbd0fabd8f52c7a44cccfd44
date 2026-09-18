const { Retry, RETRY_MODES } = require("@smithy/core/retry");
const { HttpRequest, parseUrl } = require("@smithy/core/protocols");
const { InvokeStore } = require("@aws/lambda-invoke-store");
const { normalizeProvider } = require("@smithy/core");
const { platform, release } = require("node:os");
const { versions, env } = require("node:process");
const { isValidHostLabel, isIpAddress, customEndpointFunctions } = require("@smithy/core/endpoints");
const { EndpointError, resolveEndpoint } = require("@smithy/core/endpoints");
exports.EndpointError = EndpointError;
exports.isIpAddress = isIpAddress;
exports.resolveEndpoint = resolveEndpoint;
const { loadConfig, NODE_REGION_CONFIG_OPTIONS, NODE_REGION_CONFIG_FILE_OPTIONS } = require("@smithy/core/config");
const { REGION_ENV_NAME, REGION_INI_NAME, resolveRegionConfig } = require("@smithy/core/config");
exports.NODE_REGION_CONFIG_FILE_OPTIONS = NODE_REGION_CONFIG_FILE_OPTIONS;
exports.NODE_REGION_CONFIG_OPTIONS = NODE_REGION_CONFIG_OPTIONS;
exports.REGION_ENV_NAME = REGION_ENV_NAME;
exports.REGION_INI_NAME = REGION_INI_NAME;
exports.resolveRegionConfig = resolveRegionConfig;

const state = {
    warningEmitted: false,
};
const emitWarningIfUnsupportedVersion = (version) => {
    if (version && !state.warningEmitted) {
        if (process.env.AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED === "true") {
            state.warningEmitted = true;
            return;
        }
        const userMajorVersion = parseInt(version.substring(1, version.indexOf(".")));
        const vv = 22;
        if (userMajorVersion < vv) {
            state.warningEmitted = true;
            process.emitWarning(`NodeVersionSupportWarning: The AWS SDK for JavaScript (v3)
versions published after the first week of January 2027
will require node >=${vv}. You are running node ${version}.

To continue receiving updates to AWS services, bug fixes,
and security updates please upgrade to node >=${vv}.

More information can be found at: https://a.co/c895JFp`);
        }
    }
};

const longPollMiddleware = () => (next, context) => async (args) => {
    context.__retryLongPoll = true;
    return next(args);
};
const longPollMiddlewareOptions = {
    name: "longPollMiddleware",
    tags: ["RETRY"],
    step: "initialize",
    override: true,
};
const getLongPollPlugin = (options) => ({
    applyToStack: (clientStack) => {
        clientStack.add(longPollMiddleware(), longPollMiddlewareOptions);
    },
});

function setCredentialFeature(credentials, feature, value) {
    if (!credentials.$source) {
        credentials.$source = {};
    }
    credentials.$source[feature] = value;
    return credentials;
}

Retry.v2026 ||= typeof process === "object" && process.env?.AWS_NEW_RETRIES_2026 === "true";
function setFeature(context, feature, value) {
    if (!context.__aws_sdk_context) {
        context.__aws_sdk_context = {
            features: {},
        };
    }
    else if (!context.__aws_sdk_context.features) {
        context.__aws_sdk_context.features = {};
    }
    context.__aws_sdk_context.features[feature] = value;
}

function setTokenFeature(token, feature, value) {
    if (!token.$source) {
        token.$source = {};
    }
    token.$source[feature] = value;
    return token;
}

function resolveHostHeaderConfig(input) {
    return input;
}
const hostHeaderMiddleware = (options) => (next) => async (args) => {
    if (!HttpRequest.isInstance(args.request))
        return next(args);
    const { request } = args;
    const { handlerProtocol = "" } = options.requestHandler.metadata || {};
    if (handlerProtocol.indexOf("h2") >= 0 && !request.headers[":authority"]) {
        delete request.headers["host"];
        request.headers[":authority"] = request.hostname + (request.port ? ":" + request.port : "");
    }
    else if (!request.headers["host"]) {
        let host = request.hostname;
        if (request.port != null)
            host += `:${request.port}`;
        request.headers["host"] = host;
    }
    return next(args);
};
const hostHeaderMiddlewareOptions = {
    name: "hostHeaderMiddleware",
    step: "build",
    priority: "low",
    tags: ["HOST"],
    override: true,
};
const getHostHeaderPlugin = (options) => ({
    applyToStack: (clientStack) => {
        clientStack.add(hostHeaderMiddleware(options), hostHeaderMiddlewareOptions);
    },
});

const loggerMiddleware = () => (next, context) => async (args) => {
    try {
        const response = await next(args);
        const { clientName, commandName, logger, dynamoDbDocumentClientOptions = {} } = context;
        const { overrideInputFilterSensitiveLog, overrideOutputFilterSensitiveLog } = dynamoDbDocumentClientOptions;
        const inputFilterSensitiveLog = overrideInputFilterSensitiveLog ?? context.inputFilterSensitiveLog;
        const outputFilterSensitiveLog = overrideOutputFilterSensitiveLog ?? context.outputFilterSensitiveLog;
        const { $metadata, ...outputWithoutMetadata } = response.output;
        logger?.info?.({
            clientName,
            commandName,
            input: inputFilterSensitiveLog(args.input),
            output: outputFilterSensitiveLog(outputWithoutMetadata),
            metadata: $metadata,
        });
        return response;
    }
    catch (error) {
        const { clientName, commandName, logger, dynamoDbDocumentClientOptions = {} } = context;
        const { overrideInputFilterSensitiveLog } = dynamoDbDocumentClientOptions;
        const inputFilterSensitiveLog = overrideInputFilterSensitiveLog ?? context.inputFilterSensitiveLog;
        logger?.error?.({
            clientName,
            commandName,
            input: inputFilterSensitiveLog(args.input),
            error,
            metadata: error.$metadata,
        });
        throw error;
    }
};
const loggerMiddlewareOptions = {
    name: "loggerMiddleware",
    tags: ["LOGGER"],
    step: "initialize",
    override: true,
};
const getLoggerPlugin = (options) => ({
    applyToStack: (clientStack) => {
        clientStack.add(loggerMiddleware(), loggerMiddlewareOptions);
    },
});

const recursionDetectionMiddlewareOptions = {
    step: "build",
    tags: ["RECURSION_DETECTION", "TRACE_CONTEXT_PROPAGATION"],
    name: "recursionDetectionMiddleware",
    override: true,
    priority: "low",
};

const AWS_LAMBDA_FUNCTION_NAME = "AWS_LAMBDA_FUNCTION_NAME";
const _X_AMZN_TRACE_ID = "_X_AMZN_TRACE_ID";
const X_AMZN_TRACE_ID = "X-Amzn-Trace-Id";
const TRACEPARENT = "traceparent";
const TRACESTATE = "tracestate";
const BAGGAGE = "baggage";
const recursionDetectionMiddleware = () => (next) => async (args) => {
    const { request } = args;
    if (!HttpRequest.isInstance(request)) {
        return next(args);
    }
    let invokeStore;
    {
        const traceIdHeader = Object.keys(request.headers ?? {}).find((h) => h.toLowerCase() === X_AMZN_TRACE_ID.toLowerCase()) ??
            X_AMZN_TRACE_ID;
        if (!request.headers.hasOwnProperty(traceIdHeader)) {
            const functionName = process.env[AWS_LAMBDA_FUNCTION_NAME];
            const traceIdFromEnv = process.env[_X_AMZN_TRACE_ID];
            invokeStore ??= await InvokeStore.getInstanceAsync();
            const traceIdFromInvokeStore = invokeStore?.getXRayTraceId();
            const traceId = traceIdFromInvokeStore ?? traceIdFromEnv;
            const nonEmptyString = (str) => typeof str === "string" && str.length > 0;
            if (nonEmptyString(functionName) && nonEmptyString(traceId)) {
                request.headers[X_AMZN_TRACE_ID] = traceId;
            }
        }
    }
    {
        sanitizeTraceHeaders(request.headers);
        const existingTraceparent = request.headers[TRACEPARENT];
        if (!existingTraceparent) {
            const traceparent = (invokeStore ??= await InvokeStore.getInstanceAsync())?.getTraceparent?.();
            if (traceparent) {
                request.headers[TRACEPARENT] = traceparent;
                const tracestate = invokeStore?.getTracestate?.();
                if (tracestate) {
                    request.headers[TRACESTATE] = tracestate;
                }
                const baggage = invokeStore?.getBaggage?.();
                if (baggage) {
                    request.headers[BAGGAGE] = baggage;
                }
            }
        }
    }
    return next(args);
};
function sanitizeTraceHeaders(headers) {
    for (const header of Object.keys(headers)) {
        const lower = header.toLowerCase();
        if (header !== lower && (lower === TRACEPARENT || lower === TRACESTATE || lower === BAGGAGE)) {
            headers[lower] = headers[header];
            delete headers[header];
        }
    }
}

const getRecursionDetectionPlugin = (options) => ({
    applyToStack: (clientStack) => {
        clientStack.add(recursionDetectionMiddleware(), recursionDetectionMiddlewareOptions);
    },
});

const DEFAULT_UA_APP_ID = undefined;
function isValidUserAgentAppId(appId) {
    if (appId === undefined) {
        return true;
    }
    return typeof appId === "string" && appId.length <= 50;
}
function resolveUserAgentConfig(input) {
    const normalizedAppIdProvider = normalizeProvider(input.userAgentAppId ?? DEFAULT_UA_APP_ID);
    const { customUserAgent } = input;
    return Object.assign(input, {
        customUserAgent: typeof customUserAgent === "string" ? [[customUserAgent]] : customUserAgent,
        userAgentAppId: async () => {
            const appId = await normalizedAppIdProvider();
            if (!isValidUserAgentAppId(appId)) {
                const logger = input.logger?.constructor?.name === "NoOpLogger" || !input.logger ? console : input.logger;
                if (typeof appId !== "string") {
                    logger?.warn("userAgentAppId must be a string or undefined.");
                }
                else if (appId.length > 50) {
                    logger?.warn("The provided userAgentAppId exceeds the maximum length of 50 characters.");
                }
            }
            return appId;
        },
    });
}

const partitionsInfo = {
    "partitions": [
        {
            "id": "aws",
            "outputs": {
                "dnsSuffix": "amazonaws.com",
                "dualStackDnsSuffix": "api.aws",
                "implicitGlobalRegion": "us-east-1",
                "name": "aws",
                "supportsDualStack": true,
                "supportsFIPS": true
            },
            "regionRegex": "^(us|eu|ap|sa|ca|me|af|il|mx)\\-\\w+\\-\\d+$",
            "regions": {
                "af-south-1": {
                    "description": "Africa (Cape Town)"
                },
                "ap-east-1": {
                    "description": "Asia Pacific (Hong Kong)"
                },
                "ap-east-2": {
                    "description": "Asia Pacific (Taipei)"
                },
                "ap-northeast-1": {
                    "description": "Asia Pacific (Tokyo)"
                },
                "ap-northeast-2": {
                    "description": "Asia Pacific (Seoul)"
                },
                "ap-northeast-3": {
                    "description": "Asia Pacific (Osaka)"
                },
                "ap-south-1": {
                    "description": "Asia Pacific (Mumbai)"
                },
                "ap-south-2": {
                    "description": "Asia Pacific (Hyderabad)"
                },
                "ap-southeast-1": {
                    "description": "Asia Pacific (Singapore)"
                },
                "ap-southeast-2": {
                    "description": "Asia Pacific (Sydney)"
                },
                "ap-southeast-3": {
                    "description": "Asia Pacific (Jakarta)"
                },
                "ap-southeast-4": {
                    "description": "Asia Pacific (Melbourne)"
                },
                "ap-southeast-5": {
                    "description": "Asia Pacific (Malaysia)"
                },
                "ap-southeast-6": {
                    "description": "Asia Pacific (New Zealand)"
                },
                "ap-southeast-7": {
                    "description": "Asia Pacific (Thailand)"
                },
                "aws-global": {
                    "description": "aws global region"
                },
                "ca-central-1": {
                    "description": "Canada (Central)"
                },
                "ca-west-1": {
                    "description": "Canada West (Calgary)"
                },
                "eu-central-1": {
                    "description": "Europe (Frankfurt)"
                },
                "eu-central-2": {
                    "description": "Europe (Zurich)"
                },
                "eu-north-1": {
                    "description": "Europe (Stockholm)"
                },
                "eu-south-1": {
                    "description": "Europe (Milan)"
                },
                "eu-south-2": {
                    "description": "Europe (Spain)"
                },
                "eu-west-1": {
                    "description": "Europe (Ireland)"
                },
                "eu-west-2": {
                    "description": "Europe (London)"
                },
                "eu-west-3": {
                    "description": "Europe (Paris)"
                },
                "il-central-1": {
                    "description": "Israel (Tel Aviv)"
                },
                "me-central-1": {
                    "description": "Middle East (UAE)"
                },
                "me-south-1": {
                    "description": "Middle East (Bahrain)"
                },
                "mx-central-1": {
                    "description": "Mexico (Central)"
                },
                "sa-east-1": {
                    "description": "South America (Sao Paulo)"
                },
                "us-east-1": {
                    "description": "US East (N. Virginia)"
                },
                "us-east-2": {
                    "description": "US East (Ohio)"
                },
                "us-west-1": {
                    "description": "US West (N. California)"
                },
                "us-west-2": {
                    "description": "US West (Oregon)"
                }
            }
        },
        {
            "id": "aws-cn",
            "outputs": {
                "dnsSuffix": "amazonaws.com.cn",
                "dualStackDnsSuffix": "api.amazonwebservices.com.cn",
                "implicitGlobalRegion": "cn-northwest-1",
                "name": "aws-cn",
                "supportsDualStack": true,
                "supportsFIPS": true
            },
            "regionRegex": "^cn\\-\\w+\\-\\d+$",
            "regions": {
                "aws-cn-global": {
                    "description": "aws-cn global region"
                },
                "cn-north-1": {
                    "description": "China (Beijing)"
                },
                "cn-northwest-1": {
                    "description": "China (Ningxia)"
                }
            }
        },
        {
            "id": "aws-eusc",
            "outputs": {
                "dnsSuffix": "amazonaws.eu",
                "dualStackDnsSuffix": "api.amazonwebservices.eu",
                "implicitGlobalRegion": "eusc-de-east-1",
                "name": "aws-eusc",
                "supportsDualStack": true,
                "supportsFIPS": true
            },
            "regionRegex": "^eusc\\-(de)\\-\\w+\\-\\d+$",
            "regions": {
                "eusc-de-east-1": {
                    "description": "AWS European Sovereign Cloud (Germany)"
                }
            }
        },
        {
            "id": "aws-iso",
            "outputs": {
                "dnsSuffix": "c2s.ic.gov",
                "dualStackDnsSuffix": "api.aws.ic.gov",
                "implicitGlobalRegion": "us-iso-east-1",
                "name": "aws-iso",
                "supportsDualStack": true,
                "supportsFIPS": true
            },
            "regionRegex": "^us\\-iso\\-\\w+\\-\\d+$",
            "regions": {
                "aws-iso-global": {
                    "description": "aws-iso global region"
                },
                "us-iso-east-1": {
                    "description": "US ISO East"
                },
                "us-iso-west-1": {
                    "description": "US ISO WEST"
                }
            }
        },
        {
            "id": "aws-iso-b",
            "outputs": {
                "dnsSuffix": "sc2s.sgov.gov",
                "dualStackDnsSuffix": "api.aws.scloud",
                "implicitGlobalRegion": "us-isob-east-1",
                "name": "aws-iso-b",
                "supportsDualStack": true,
                "supportsFIPS": true
            },
            "regionRegex": "^us\\-isob\\-\\w+\\-\\d+$",
            "regions": {
                "aws-iso-b-global": {
                    "description": "aws-iso-b global region"
                },
                "us-isob-east-1": {
                    "description": "US ISOB East (Ohio)"
                },
                "us-isob-west-1": {
                    "description": "US ISOB West"
                }
            }
        },
        {
            "id": "aws-iso-e",
            "outputs": {
                "dnsSuffix": "cloud.adc-e.uk",
                "dualStackDnsSuffix": "api.cloud-aws.adc-e.uk",
                "implicitGlobalRegion": "eu-isoe-west-1",
                "name": "aws-iso-e",
                "supportsDualStack": true,
                "supportsFIPS": true
            },
            "regionRegex": "^eu\\-isoe\\-\\w+\\-\\d+$",
            "regions": {
                "aws-iso-e-global": {
                    "description": "aws-iso-e global region"
                },
                "eu-isoe-west-1": {
                    "description": "EU ISOE West"
                }
            }
        },
        {
            "id": "aws-iso-f",
            "outputs": {
                "dnsSuffix": "csp.hci.ic.gov",
                "dualStackDnsSuffix": "api.aws.hci.ic.gov",
                "implicitGlobalRegion": "us-isof-south-1",
                "name": "aws-iso-f",
                "supportsDualStack": true,
                "supportsFIPS": true
            },
            "regionRegex": "^us\\-isof\\-\\w+\\-\\d+$",
            "regions": {
                "aws-iso-f-global": {
                    "description": "aws-iso-f global region"
                },
                "us-isof-east-1": {
                    "description": "US ISOF EAST"
                },
                "us-isof-south-1": {
                    "description": "US ISOF SOUTH"
                }
            }
        },
        {
            "id": "aws-us-gov",
            "outputs": {
                "dnsSuffix": "amazonaws.com",
                "dualStackDnsSuffix": "api.aws",
                "implicitGlobalRegion": "us-gov-west-1",
                "name": "aws-us-gov",
                "supportsDualStack": true,
                "supportsFIPS": true
            },
            "regionRegex": "^us\\-gov\\-\\w+\\-\\d+$",
            "regions": {
                "aws-us-gov-global": {
                    "description": "aws-us-gov global region"
                },
                "us-gov-east-1": {
                    "description": "AWS GovCloud (US-East)"
                },
                "us-gov-west-1": {
                    "description": "AWS GovCloud (US-West)"
                }
            }
        }
    ],
    "version": "1.1"
};

let selectedPartitionsInfo = partitionsInfo;
let selectedUserAgentPrefix = "";
const partition = (value) => {
    const { partitions } = selectedPartitionsInfo;
    for (const partition of partitions) {
        const { regions, outputs } = partition;
        for (const [region, regionData] of Object.entries(regions)) {
            if (region === value) {
                return {
                    ...outputs,
                    ...regionData,
                };
            }
        }
    }
    for (const partition of partitions) {
        const { regionRegex, outputs } = partition;
        if (new RegExp(regionRegex).test(value)) {
            return {
                ...outputs,
            };
        }
    }
    const DEFAULT_PARTITION = partitions.find((partition) => partition.id === "aws");
    if (!DEFAULT_PARTITION) {
        throw new Error("Provided region was not found in the partition array or regex," +
            " and default partition with id 'aws' doesn't exist.");
    }
    return {
        ...DEFAULT_PARTITION.outputs,
    };
};
const setPartitionInfo = (partitionsInfo, userAgentPrefix = "") => {
    selectedPartitionsInfo = partitionsInfo;
    selectedUserAgentPrefix = userAgentPrefix;
};
const useDefaultPartitionInfo = () => {
    setPartitionInfo(partitionsInfo, "");
};
const getUserAgentPrefix = () => selectedUserAgentPrefix;

const ACCOUNT_ID_ENDPOINT_REGEX = /\d{12}\.ddb/;
async function checkFeatures(context, config, args) {
    const request = args.request;
    if (request?.headers?.["smithy-protocol"] === "rpc-v2-cbor") {
        setFeature(context, "PROTOCOL_RPC_V2_CBOR", "M");
    }
    if (typeof config.retryStrategy === "function") {
        const retryStrategy = await config.retryStrategy();
        if (typeof retryStrategy.mode === "string") {
            switch (retryStrategy.mode) {
                case RETRY_MODES.ADAPTIVE:
                    setFeature(context, "RETRY_MODE_ADAPTIVE", "F");
                    break;
                case RETRY_MODES.STANDARD:
                    setFeature(context, "RETRY_MODE_STANDARD", "E");
                    break;
            }
        }
    }
    if (typeof config.accountIdEndpointMode === "function") {
        const endpointV2 = context.endpointV2;
        if (String(endpointV2?.url?.hostname).match(ACCOUNT_ID_ENDPOINT_REGEX)) {
            setFeature(context, "ACCOUNT_ID_ENDPOINT", "O");
        }
        switch (await config.accountIdEndpointMode?.()) {
            case "disabled":
                setFeature(context, "ACCOUNT_ID_MODE_DISABLED", "Q");
                break;
            case "preferred":
                setFeature(context, "ACCOUNT_ID_MODE_PREFERRED", "P");
                break;
            case "required":
                setFeature(context, "ACCOUNT_ID_MODE_REQUIRED", "R");
                break;
        }
    }
    const identity = context.__smithy_context?.selectedHttpAuthScheme?.identity;
    if (identity?.$source) {
        const credentials = identity;
        if (credentials.accountId) {
            setFeature(context, "RESOLVED_ACCOUNT_ID", "T");
        }
        for (const [key, value] of Object.entries(credentials.$source ?? {})) {
            setFeature(context, key, value);
        }
    }
}

const USER_AGENT = "user-agent";
const X_AMZ_USER_AGENT = "x-amz-user-agent";
const SPACE = " ";
const UA_NAME_SEPARATOR = "/";
const UA_NAME_ESCAPE_REGEX = /[^!$%&'*+\-.^_`|~\w]/g;
const UA_VALUE_ESCAPE_REGEX = /[^!$%&'*+\-.^_`|~\w#]/g;
const UA_ESCAPE_CHAR = "-";

const BYTE_LIMIT = 1024;
function encodeFeatures(features) {
    let buffer = "";
    for (const key in features) {
        const val = features[key];
        if (buffer.length + val.length + 1 <= BYTE_LIMIT) {
            if (buffer.length) {
                buffer += "," + val;
            }
            else {
                buffer += val;
            }
            continue;
        }
        break;
    }
    return buffer;
}

const userAgentMiddleware = (options) => (next, context) => async (args) => {
    const { request } = args;
    if (!HttpRequest.isInstance(request)) {
        return next(args);
    }
    const { headers } = request;
    const userAgent = context?.userAgent?.map(escapeUserAgent) || [];
    const defaultUserAgent = (await options.defaultUserAgentProvider()).map(escapeUserAgent);
    await checkFeatures(context, options, args);
    const awsContext = context;
    defaultUserAgent.push(`m/${encodeFeatures(Object.assign({}, context.__smithy_context?.features, awsContext.__aws_sdk_context?.features))}`);
    const customUserAgent = options?.customUserAgent?.map(escapeUserAgent) || [];
    const appId = await options.userAgentAppId();
    if (appId) {
        defaultUserAgent.push(escapeUserAgent([`app`, `${appId}`]));
    }
    const prefix = getUserAgentPrefix();
    const sdkUserAgentValue = (prefix ? [prefix] : [])
        .concat([...defaultUserAgent, ...userAgent, ...customUserAgent])
        .join(SPACE);
    const normalUAValue = [
        ...defaultUserAgent.filter((section) => section.startsWith("aws-sdk-")),
        ...customUserAgent,
    ].join(SPACE);
    if (options.runtime !== "browser") {
        if (normalUAValue) {
            headers[X_AMZ_USER_AGENT] = headers[X_AMZ_USER_AGENT]
                ? `${headers[USER_AGENT]} ${normalUAValue}`
                : normalUAValue;
        }
        headers[USER_AGENT] = sdkUserAgentValue;
    }
    else {
        headers[X_AMZ_USER_AGENT] = sdkUserAgentValue;
    }
    return next({
        ...args,
        request,
    });
};
const escapeUserAgent = (userAgentPair) => {
    const name = userAgentPair[0]
        .split(UA_NAME_SEPARATOR)
        .map((part) => part.replace(UA_NAME_ESCAPE_REGEX, UA_ESCAPE_CHAR))
        .join(UA_NAME_SEPARATOR);
    const version = userAgentPair[1]?.replace(UA_VALUE_ESCAPE_REGEX, UA_ESCAPE_CHAR);
    const prefixSeparatorIndex = name.indexOf(UA_NAME_SEPARATOR);
    const prefix = name.substring(0, prefixSeparatorIndex);
    let uaName = name.substring(prefixSeparatorIndex + 1);
    if (prefix === "api") {
        uaName = uaName.toLowerCase();
    }
    return [prefix, uaName, version]
        .filter((item) => item && item.length > 0)
        .reduce((acc, item, index) => {
        switch (index) {
            case 0:
                return item;
            case 1:
                return `${acc}/${item}`;
            default:
                return `${acc}#${item}`;
        }
    }, "");
};
const getUserAgentMiddlewareOptions = {
    name: "getUserAgentMiddleware",
    step: "build",
    priority: "low",
    tags: ["SET_USER_AGENT", "USER_AGENT"],
    override: true,
};
const getUserAgentPlugin = (config) => ({
    applyToStack: (clientStack) => {
        clientStack.add(userAgentMiddleware(config), getUserAgentMiddlewareOptions);
    },
});

const getRuntimeUserAgentPair = () => {
    const runtimesToCheck = ["deno", "bun", "llrt"];
    for (const runtime of runtimesToCheck) {
        if (versions[runtime]) {
            return [`md/${runtime}`, versions[runtime]];
        }
    }
    return ["md/nodejs", versions.node];
};

const crtAvailability = {
    isCrtAvailable: false,
};

const isCrtAvailable = () => {
    if (crtAvailability.isCrtAvailable) {
        return ["md/crt-avail"];
    }
    return null;
};

const createDefaultUserAgentProvider = ({ serviceId, clientVersion }) => {
    const runtimeUserAgentPair = getRuntimeUserAgentPair();
    return async (config) => {
        const sections = [
            ["aws-sdk-js", clientVersion],
            ["ua", "2.1"],
            [`os/${platform()}`, release()],
            ["lang/js"],
            runtimeUserAgentPair,
        ];
        const crtAvailable = isCrtAvailable();
        if (crtAvailable) {
            sections.push(crtAvailable);
        }
        if (serviceId) {
            sections.push([`api/${serviceId}`, clientVersion]);
        }
        if (env.AWS_EXECUTION_ENV) {
            sections.push([`exec-env/${env.AWS_EXECUTION_ENV}`]);
        }
        const appId = await config?.userAgentAppId?.();
        const resolvedUserAgent = appId ? [...sections, [`app/${appId}`]] : [...sections];
        return resolvedUserAgent;
    };
};
const defaultUserAgent = createDefaultUserAgentProvider;

const UA_APP_ID_ENV_NAME = "AWS_SDK_UA_APP_ID";
const UA_APP_ID_INI_NAME = "sdk_ua_app_id";
const UA_APP_ID_INI_NAME_DEPRECATED = "sdk-ua-app-id";
const NODE_APP_ID_CONFIG_OPTIONS = {
    environmentVariableSelector: (env) => env[UA_APP_ID_ENV_NAME],
    configFileSelector: (profile) => profile[UA_APP_ID_INI_NAME] ?? profile[UA_APP_ID_INI_NAME_DEPRECATED],
    default: DEFAULT_UA_APP_ID,
};

const createUserAgentStringParsingProvider = ({ serviceId, clientVersion }) => async (config) => {
    const module = require('bowser');
    const parse = module.parse ?? module.default.parse ?? (() => "");
    const parsedUA = typeof window !== "undefined" && window?.navigator?.userAgent ? parse(window.navigator.userAgent) : undefined;
    const sections = [
        ["aws-sdk-js", clientVersion],
        ["ua", "2.1"],
        [`os/${parsedUA?.os?.name || "other"}`, parsedUA?.os?.version],
        ["lang/js"],
        ["md/browser", `${parsedUA?.browser?.name ?? "unknown"}_${parsedUA?.browser?.version ?? "unknown"}`],
    ];
    if (serviceId) {
        sections.push([`api/${serviceId}`, clientVersion]);
    }
    const appId = await config?.userAgentAppId?.();
    if (appId) {
        sections.push([`app/${appId}`]);
    }
    return sections;
};

const fallback = {
    os(ua) {
        if (/iPhone|iPad|iPod/.test(ua))
            return "iOS";
        if (/Macintosh|Mac OS X/.test(ua))
            return "macOS";
        if (/Windows NT/.test(ua))
            return "Windows";
        if (/Android/.test(ua))
            return "Android";
        if (/Linux/.test(ua))
            return "Linux";
        return undefined;
    },
    browser(ua) {
        if (/EdgiOS|EdgA|Edg\//.test(ua))
            return "Microsoft Edge";
        if (/Firefox\//.test(ua))
            return "Firefox";
        if (/Chrome\//.test(ua))
            return "Chrome";
        if (/Safari\//.test(ua))
            return "Safari";
        return undefined;
    },
};

const isVirtualHostableS3Bucket = (value, allowSubDomains = false) => {
    if (allowSubDomains) {
        for (const label of value.split(".")) {
            if (!isVirtualHostableS3Bucket(label)) {
                return false;
            }
        }
        return true;
    }
    if (!isValidHostLabel(value)) {
        return false;
    }
    if (value.length < 3 || value.length > 63) {
        return false;
    }
    if (value !== value.toLowerCase()) {
        return false;
    }
    if (isIpAddress(value)) {
        return false;
    }
    return true;
};

const ARN_DELIMITER = ":";
const RESOURCE_DELIMITER = "/";
const parseArn = (value) => {
    const segments = value.split(ARN_DELIMITER);
    if (segments.length < 6)
        return null;
    const [arn, partition, service, region, accountId, ...resourcePath] = segments;
    if (arn !== "arn" || partition === "" || service === "" || resourcePath.join(ARN_DELIMITER) === "")
        return null;
    const resourceId = resourcePath.map((resource) => resource.split(RESOURCE_DELIMITER)).flat();
    return {
        partition,
        service,
        region,
        accountId,
        resourceId,
    };
};

const awsEndpointFunctions = {
    isVirtualHostableS3Bucket: isVirtualHostableS3Bucket,
    parseArn: parseArn,
    partition: partition,
};
customEndpointFunctions.aws = awsEndpointFunctions;

const resolveDefaultAwsRegionalEndpointsConfig = (input) => {
    if (typeof input.endpointProvider !== "function") {
        throw new Error("@aws-sdk/util-endpoint - endpointProvider and endpoint missing in config for this client.");
    }
    const { endpoint } = input;
    if (endpoint === undefined) {
        input.endpoint = async () => {
            return toEndpointV1(input.endpointProvider({
                Region: typeof input.region === "function" ? await input.region() : input.region,
                UseDualStack: typeof input.useDualstackEndpoint === "function"
                    ? await input.useDualstackEndpoint()
                    : input.useDualstackEndpoint,
                UseFIPS: typeof input.useFipsEndpoint === "function" ? await input.useFipsEndpoint() : input.useFipsEndpoint,
                Endpoint: undefined,
            }, { logger: input.logger }));
        };
    }
    return input;
};
const toEndpointV1 = (endpoint) => parseUrl(endpoint.url);

function stsRegionDefaultResolver(loaderConfig = {}) {
    return loadConfig({
        ...NODE_REGION_CONFIG_OPTIONS,
        async default() {
            if (!warning.silence) {
                console.warn("@aws-sdk - WARN - default STS region of us-east-1 used. See @aws-sdk/credential-providers README and set a region explicitly.");
            }
            return "us-east-1";
        },
    }, { ...NODE_REGION_CONFIG_FILE_OPTIONS, ...loaderConfig });
}
const warning = {
    silence: false,
};

const getAwsRegionExtensionConfiguration = (runtimeConfig) => {
    return {
        setRegion(region) {
            runtimeConfig.region = region;
        },
        region() {
            return runtimeConfig.region;
        },
    };
};
const resolveAwsRegionExtensionConfiguration = (awsRegionExtensionConfiguration) => {
    return {
        region: awsRegionExtensionConfiguration.region(),
    };
};

exports.DEFAULT_UA_APP_ID = DEFAULT_UA_APP_ID;
exports.NODE_APP_ID_CONFIG_OPTIONS = NODE_APP_ID_CONFIG_OPTIONS;
exports.UA_APP_ID_ENV_NAME = UA_APP_ID_ENV_NAME;
exports.UA_APP_ID_INI_NAME = UA_APP_ID_INI_NAME;
exports.awsEndpointFunctions = awsEndpointFunctions;
exports.createDefaultUserAgentProvider = createDefaultUserAgentProvider;
exports.createUserAgentStringParsingProvider = createUserAgentStringParsingProvider;
exports.crtAvailability = crtAvailability;
exports.defaultUserAgent = defaultUserAgent;
exports.emitWarningIfUnsupportedVersion = emitWarningIfUnsupportedVersion;
exports.fallback = fallback;
exports.getAwsRegionExtensionConfiguration = getAwsRegionExtensionConfiguration;
exports.getHostHeaderPlugin = getHostHeaderPlugin;
exports.getLoggerPlugin = getLoggerPlugin;
exports.getLongPollPlugin = getLongPollPlugin;
exports.getRecursionDetectionPlugin = getRecursionDetectionPlugin;
exports.getUserAgentMiddlewareOptions = getUserAgentMiddlewareOptions;
exports.getUserAgentPlugin = getUserAgentPlugin;
exports.getUserAgentPrefix = getUserAgentPrefix;
exports.hostHeaderMiddleware = hostHeaderMiddleware;
exports.hostHeaderMiddlewareOptions = hostHeaderMiddlewareOptions;
exports.isVirtualHostableS3Bucket = isVirtualHostableS3Bucket;
exports.loggerMiddleware = loggerMiddleware;
exports.loggerMiddlewareOptions = loggerMiddlewareOptions;
exports.parseArn = parseArn;
exports.partition = partition;
exports.recursionDetectionMiddleware = recursionDetectionMiddleware;
exports.recursionDetectionMiddlewareOptions = recursionDetectionMiddlewareOptions;
exports.resolveAwsRegionExtensionConfiguration = resolveAwsRegionExtensionConfiguration;
exports.resolveDefaultAwsRegionalEndpointsConfig = resolveDefaultAwsRegionalEndpointsConfig;
exports.resolveHostHeaderConfig = resolveHostHeaderConfig;
exports.resolveUserAgentConfig = resolveUserAgentConfig;
exports.setCredentialFeature = setCredentialFeature;
exports.setFeature = setFeature;
exports.setPartitionInfo = setPartitionInfo;
exports.setTokenFeature = setTokenFeature;
exports.state = state;
exports.stsRegionDefaultResolver = stsRegionDefaultResolver;
exports.stsRegionWarning = warning;
exports.toEndpointV1 = toEndpointV1;
exports.useDefaultPartitionInfo = useDefaultPartitionInfo;
exports.userAgentMiddleware = userAgentMiddleware;
