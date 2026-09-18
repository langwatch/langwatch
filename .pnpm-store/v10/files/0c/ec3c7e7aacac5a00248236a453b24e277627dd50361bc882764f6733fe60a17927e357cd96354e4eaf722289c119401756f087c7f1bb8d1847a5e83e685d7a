import type { AwsCredentialIdentity } from "@aws-sdk/types";
import { SignatureV4 } from "@smithy/signature-v4";
import type { HttpRequest as IHttpRequest, RequestPresigningArguments, RequestSigningArguments } from "@smithy/types";
/**
 * @internal
 */
export declare const SESSION_TOKEN_QUERY_PARAM = "X-Amz-S3session-Token";
/**
 * @internal
 */
export declare const SESSION_TOKEN_HEADER: string;
/**
 * A SignatureV4 signer that supports signing/presigning with alternate credentials.
 * Used for S3 Express session-based auth.
 * @internal
 */
export declare class SignatureV4SignWithCredentials extends SignatureV4 {
    signWithCredentials(requestToSign: IHttpRequest, credentials: AwsCredentialIdentity, options?: RequestSigningArguments): Promise<IHttpRequest>;
    presignWithCredentials(requestToSign: IHttpRequest, credentials: AwsCredentialIdentity, options?: RequestPresigningArguments): Promise<IHttpRequest>;
}
