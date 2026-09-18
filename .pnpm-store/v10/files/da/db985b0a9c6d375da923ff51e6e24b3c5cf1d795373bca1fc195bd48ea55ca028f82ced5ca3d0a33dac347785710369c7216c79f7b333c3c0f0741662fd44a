import { Retry } from "@smithy/core/retry";
Retry.v2026 ||= typeof process === "object" && process.env?.AWS_NEW_RETRIES_2026 === "true";
export function setFeature(context, feature, value) {
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
