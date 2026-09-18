import { HttpRequest } from "@smithy/core/protocols";
import { getSkewCorrectedDate } from "../utils";
import { AwsSdkSigV4Signer, validateSigningProperties } from "./AwsSdkSigV4Signer";
export class AwsSdkSigV4ASigner extends AwsSdkSigV4Signer {
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
