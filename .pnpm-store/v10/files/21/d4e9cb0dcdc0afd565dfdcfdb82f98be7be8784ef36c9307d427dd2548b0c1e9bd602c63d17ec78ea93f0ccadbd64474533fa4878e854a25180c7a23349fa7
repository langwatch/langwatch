import { makeBuilder } from "@smithy/core/client";
import { getEndpointPlugin } from "@smithy/core/endpoints";
import { commonParams } from "./endpoint/EndpointParameters";
export const command = makeBuilder(commonParams, "Signin", "SigninClient", getEndpointPlugin);
export const _ep0 = {
    IsControlPlane: { type: "staticContextParams", value: false },
};
export const _ep1 = {
    IsOAuthEndpoint: { type: "staticContextParams", value: true },
};
export const _mw0 = (Command, cs, config, o) => [];
