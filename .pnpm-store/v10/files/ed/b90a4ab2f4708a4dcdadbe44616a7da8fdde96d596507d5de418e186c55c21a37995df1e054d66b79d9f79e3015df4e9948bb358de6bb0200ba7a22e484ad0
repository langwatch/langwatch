import { CredentialsProviderError } from "@smithy/core/config";
import { fromImdsCredentials, isImdsCredentials } from "./remoteProvider/ImdsCredentials";
import { providerConfigFromInit } from "./remoteProvider/RemoteProviderInit";
import { httpRequest } from "./remoteProvider/httpRequest";
import { retry } from "./remoteProvider/retry";
export const ENV_CMDS_FULL_URI = "AWS_CONTAINER_CREDENTIALS_FULL_URI";
export const ENV_CMDS_RELATIVE_URI = "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI";
export const ENV_CMDS_AUTH_TOKEN = "AWS_CONTAINER_AUTHORIZATION_TOKEN";
export const fromContainerMetadata = (init = {}) => {
    const { timeout, maxRetries } = providerConfigFromInit(init);
    return () => retry(async () => {
        const requestOptions = await getCmdsUri({ logger: init.logger });
        const credsResponse = JSON.parse(await requestFromEcsImds(timeout, requestOptions));
        if (!isImdsCredentials(credsResponse)) {
            throw new CredentialsProviderError("Invalid response received from instance metadata service.", {
                logger: init.logger,
            });
        }
        return fromImdsCredentials(credsResponse);
    }, maxRetries);
};
const requestFromEcsImds = async (timeout, options) => {
    if (process.env[ENV_CMDS_AUTH_TOKEN]) {
        options.headers = {
            ...options.headers,
            Authorization: process.env[ENV_CMDS_AUTH_TOKEN],
        };
    }
    const buffer = await httpRequest({
        ...options,
        timeout,
    });
    return buffer.toString();
};
const CMDS_IP = "169.254.170.2";
const GREENGRASS_HOSTS = new Set(["localhost", "127.0.0.1"]);
const GREENGRASS_PROTOCOLS = new Set(["http:", "https:"]);
const getCmdsUri = async ({ logger }) => {
    if (process.env[ENV_CMDS_RELATIVE_URI]) {
        return {
            hostname: CMDS_IP,
            path: process.env[ENV_CMDS_RELATIVE_URI],
        };
    }
    if (process.env[ENV_CMDS_FULL_URI]) {
        let parsed;
        try {
            parsed = new URL(process.env[ENV_CMDS_FULL_URI]);
        }
        catch {
            throw new CredentialsProviderError(`${process.env[ENV_CMDS_FULL_URI]} is not a valid container metadata service URL`, { tryNextLink: false, logger });
        }
        if (!parsed.hostname || !GREENGRASS_HOSTS.has(parsed.hostname)) {
            throw new CredentialsProviderError(`${parsed.hostname} is not a valid container metadata service hostname`, {
                tryNextLink: false,
                logger,
            });
        }
        if (!parsed.protocol || !GREENGRASS_PROTOCOLS.has(parsed.protocol)) {
            throw new CredentialsProviderError(`${parsed.protocol} is not a valid container metadata service protocol`, {
                tryNextLink: false,
                logger,
            });
        }
        return {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            port: parsed.port ? parseInt(parsed.port, 10) : undefined,
        };
    }
    throw new CredentialsProviderError("The container metadata credential provider cannot be used unless" +
        ` the ${ENV_CMDS_RELATIVE_URI} or ${ENV_CMDS_FULL_URI} environment` +
        " variable is set", {
        tryNextLink: false,
        logger,
    });
};
