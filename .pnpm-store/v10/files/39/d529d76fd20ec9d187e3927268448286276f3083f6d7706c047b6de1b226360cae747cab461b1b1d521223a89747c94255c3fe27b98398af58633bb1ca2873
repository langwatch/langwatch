import type { EventSigner, EventSigningArguments, FormattedEvent, HttpRequest, MessageSigner, MessageSigningArguments, RequestPresigner, RequestPresigningArguments, RequestSigner, RequestSigningArguments, SignableMessage, SignedMessage, SigningArguments, StringSigner } from "@smithy/types";
import { SignatureV4Base, type SignatureV4CryptoInit, type SignatureV4Init } from "./SignatureV4Base";
/**
 * @public
 */
export declare class SignatureV4 extends SignatureV4Base implements RequestPresigner, RequestSigner, StringSigner, EventSigner, MessageSigner {
    private readonly headerFormatter;
    constructor({ applyChecksum, credentials, region, service, sha256, uriEscapePath, }: SignatureV4Init & SignatureV4CryptoInit);
    presign(originalRequest: HttpRequest, options?: RequestPresigningArguments): Promise<HttpRequest>;
    sign(stringToSign: string, options?: SigningArguments): Promise<string>;
    sign(event: FormattedEvent, options: EventSigningArguments): Promise<string>;
    sign(event: SignableMessage, options: MessageSigningArguments): Promise<SignedMessage>;
    sign(requestToSign: HttpRequest, options?: RequestSigningArguments): Promise<HttpRequest>;
    private signEvent;
    signMessage(signableMessage: SignableMessage, { signingDate, signingRegion, signingService, eventStreamCredentials }: MessageSigningArguments): Promise<SignedMessage>;
    private signString;
    private signRequest;
    private getSignature;
    private getSigningKey;
}
