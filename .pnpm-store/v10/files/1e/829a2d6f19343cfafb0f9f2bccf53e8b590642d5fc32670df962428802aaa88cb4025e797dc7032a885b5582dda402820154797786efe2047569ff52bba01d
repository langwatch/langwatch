import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Hash } from '@smithy/hash-node';
import { SignatureV4 } from '@smithy/signature-v4';
import * as Errors from "../../error.mjs";
import { assertProviderOwnsAuthorization, errorWithCause, normalizeOptionalString, resolveBedrockBearerAuth, resolveBedrockEndpoint, } from "../../internal/bedrock.mjs";
import { createProvider } from "../../internal/provider.mjs";
const BEDROCK_SERVICE = 'bedrock-mantle';
function validateStaticCredentials(options) {
    const hasAccessKey = options.accessKeyId !== undefined;
    const hasSecretKey = options.secretAccessKey !== undefined;
    if (hasAccessKey !== hasSecretKey || (options.sessionToken !== undefined && !hasAccessKey)) {
        throw new Errors.OpenAIError('The `accessKeyId` and `secretAccessKey` options must be provided together. A `sessionToken` may only be used with both.');
    }
    if (!hasAccessKey)
        return undefined;
    if (typeof options.accessKeyId !== 'string' ||
        !options.accessKeyId.trim() ||
        typeof options.secretAccessKey !== 'string' ||
        !options.secretAccessKey.trim()) {
        throw new Errors.OpenAIError('Static AWS credentials require non-empty `accessKeyId` and `secretAccessKey` values.');
    }
    if (options.sessionToken !== undefined &&
        (typeof options.sessionToken !== 'string' || !options.sessionToken.trim())) {
        throw new Errors.OpenAIError('A static AWS `sessionToken` must not be empty when provided.');
    }
    return {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
    };
}
function requestTarget(parsedURL) {
    const query = {};
    for (const [name, value] of parsedURL.searchParams) {
        const existing = query[name];
        query[name] =
            existing === undefined ? value
                : typeof existing === 'string' ? [existing, value]
                    : [...existing, value];
    }
    return { path: parsedURL.pathname, query };
}
function signableBody(body) {
    if (body === undefined || body === null)
        return undefined;
    if (typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body))
        return body;
    throw new Errors.OpenAIError("The SDK's Bedrock SigV4 mode requires a replayable request body. Buffer the body before sending or use bearer authentication.");
}
function validateCredentialIdentity(identity) {
    if (typeof identity?.accessKeyId !== 'string' ||
        !identity.accessKeyId.trim() ||
        typeof identity.secretAccessKey !== 'string' ||
        !identity.secretAccessKey.trim() ||
        (identity.sessionToken !== undefined &&
            (typeof identity.sessionToken !== 'string' || !identity.sessionToken.trim()))) {
        throw new Errors.OpenAIError('Failed to resolve AWS credentials for Bedrock. Verify your AWS profile, environment variables, or runtime identity configuration and try again.');
    }
    return identity;
}
class BedrockSigV4Auth {
    constructor(options) {
        this.options = options;
    }
    credentialsProvider() {
        if (this.resolvedCredentialsProvider)
            return this.resolvedCredentialsProvider;
        if (this.options.staticCredentials) {
            const credentials = this.options.staticCredentials;
            return (this.resolvedCredentialsProvider = async () => credentials);
        }
        if (this.options.credentialProvider) {
            const provider = this.options.credentialProvider;
            return (this.resolvedCredentialsProvider = async () => validateCredentialIdentity(await provider()));
        }
        const provider = defaultProvider(this.options.profile ? { profile: this.options.profile } : {});
        return (this.resolvedCredentialsProvider = async () => validateCredentialIdentity(await provider()));
    }
    signatureV4() {
        return (this.signer ?? (this.signer = new SignatureV4({
            credentials: this.credentialsProvider(),
            region: this.options.region,
            service: BEDROCK_SERVICE,
            sha256: Hash.bind(null, 'sha256'),
        })));
    }
    async prepareRequest(request, { url }) {
        if (Object.prototype.toString.call(globalThis.process) !== '[object process]') {
            throw new Errors.OpenAIError('Bedrock AWS credential authentication is only supported in Node.js and compatible server runtimes. Use bearer authentication in this runtime.');
        }
        const parsedURL = new URL(url);
        const canonicalRegion = /^bedrock-mantle\.([a-z0-9-]+)\.api\.aws$/i.exec(parsedURL.hostname)?.[1];
        if (canonicalRegion && canonicalRegion !== this.options.region) {
            throw new Errors.OpenAIError(`The Bedrock endpoint region \`${canonicalRegion}\` does not match the SigV4 region \`${this.options.region}\`.`);
        }
        const headers = new Headers(request.headers);
        assertProviderOwnsAuthorization(headers);
        headers.delete('x-amz-date');
        headers.delete('x-amz-security-token');
        headers.delete('x-amz-content-sha256');
        headers.set('host', parsedURL.host);
        const method = (request.method ?? 'GET').toUpperCase();
        const body = signableBody(request.body);
        let signed;
        try {
            signed = await this.signatureV4().sign({
                protocol: parsedURL.protocol,
                hostname: parsedURL.hostname,
                ...(parsedURL.port ? { port: Number(parsedURL.port) } : {}),
                method,
                ...requestTarget(parsedURL),
                headers: Object.fromEntries(headers.entries()),
                ...(body !== undefined ? { body } : {}),
            });
        }
        catch (cause) {
            const message = this.options.usesDefaultChain ?
                'Could not find credentials for Bedrock. Pass AWS credentials to `bedrock(...)` or configure the default AWS credential chain.'
                : 'Failed to resolve AWS credentials for Bedrock. Verify your AWS profile, environment variables, or runtime identity configuration and try again.';
            throw errorWithCause(message, cause);
        }
        request.method = method;
        request.redirect = 'manual';
        request.headers = new Headers(signed.headers);
    }
}
/** Configure the standard OpenAI client for Amazon Bedrock using bearer or AWS authentication. */
export function bedrock(options = {}) {
    const staticCredentials = validateStaticCredentials(options);
    const profile = normalizeOptionalString(options.profile);
    if (options.profile !== undefined && !profile) {
        throw new Errors.OpenAIError('The Bedrock AWS `profile` must not be empty.');
    }
    const awsModes = [!!staticCredentials, !!profile, !!options.credentialProvider].filter(Boolean).length;
    if (awsModes > 1) {
        throw new Errors.OpenAIError('Bedrock authentication is ambiguous. Configure exactly one explicit AWS mode: static credentials, profile, or credential provider.');
    }
    const explicitAwsAuth = awsModes === 1;
    const bearerAuth = resolveBedrockBearerAuth(options, { allowEnvironment: !explicitAwsAuth });
    if (bearerAuth.explicit && explicitAwsAuth) {
        throw new Errors.OpenAIError('Bearer and AWS credential authentication are mutually exclusive. Configure exactly one explicit mode: bearer credential, static AWS credentials, profile, or credential provider.');
    }
    const { region, baseURL } = resolveBedrockEndpoint(options);
    if (!bearerAuth.factory && !region) {
        throw new Errors.OpenAIError('Bedrock requires an AWS region. Pass `region` to `bedrock(...)`, or set `AWS_REGION` or `AWS_DEFAULT_REGION`.');
    }
    const credentialProvider = options.credentialProvider;
    return createProvider({
        configure() {
            const auth = bearerAuth.factory?.() ??
                new BedrockSigV4Auth({
                    region: region,
                    staticCredentials,
                    profile,
                    credentialProvider,
                    usesDefaultChain: !explicitAwsAuth,
                });
            return {
                name: 'bedrock',
                baseURL,
                prepareRequest: auth.prepareRequest.bind(auth),
            };
        },
    });
}
//# sourceMappingURL=aws.mjs.map