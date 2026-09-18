import { awsEndpointFunctions } from "@aws-sdk/core/client";
import { customEndpointFunctions, decideEndpoint, EndpointCache } from "@smithy/core/endpoints";
import { bdd } from "./bdd";
const cache = new EndpointCache({
    size: 50,
    params: ["Endpoint", "Region", "UseDualStack", "UseFIPS", "UseGlobalEndpoint"],
});
export const defaultEndpointResolver = (endpointParams, context = {}) => {
    return cache.get(endpointParams, () => decideEndpoint(bdd, {
        endpointParams: endpointParams,
        logger: context.logger,
    }));
};
customEndpointFunctions.aws = awsEndpointFunctions;
