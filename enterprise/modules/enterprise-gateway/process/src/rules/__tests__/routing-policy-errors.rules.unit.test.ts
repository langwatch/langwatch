// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  RoutingPolicyProviderOutOfScopeError,
  RoutingPolicyProviderScopeError,
} from "@langwatch/enterprise-gateway-contract";
import { describe, expect, it } from "vitest";

import { asHandledRoutingPolicyError } from "../routing-policy-errors.rules.ts";

describe("asHandledRoutingPolicyError", () => {
  it("answers a provider from another organization as a handled 422", () => {
    const handled = asHandledRoutingPolicyError(new RoutingPolicyProviderScopeError());

    expect(handled).toBeInstanceOf(RoutingPolicyProviderOutOfScopeError);
  });

  it("leaves an unknown error as it is", () => {
    const error = new Error("socket hang up");

    expect(asHandledRoutingPolicyError(error)).toBe(error);
  });
});
