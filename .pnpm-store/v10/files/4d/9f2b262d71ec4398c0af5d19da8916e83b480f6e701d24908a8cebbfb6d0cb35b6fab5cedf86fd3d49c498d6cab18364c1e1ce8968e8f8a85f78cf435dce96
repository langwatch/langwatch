import { HttpRequest } from "@smithy/core/protocols";
import { getAgeHeader, getDateHeader, getSkewCorrectedDate, getUpdatedSystemClockOffset } from "../utils";
const throwSigningPropertyError = (name, property) => {
    if (!property) {
        throw new Error(`Property \`${name}\` is not resolved for AWS SDK SigV4Auth`);
    }
    return property;
};
export const validateSigningProperties = async (signingProperties) => {
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
export class AwsSdkSigV4Signer {
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
export const AWSSDKSigV4Signer = AwsSdkSigV4Signer;
