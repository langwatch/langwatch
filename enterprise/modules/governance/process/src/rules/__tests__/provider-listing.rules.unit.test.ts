// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ProviderSignInError } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { refusalFromThrown } from "../provider-listing.rules.ts";

describe("refusalFromThrown", () => {
  describe("given a sign-in the provider refused", () => {
    it("reads a 401 as unauthorized, carrying the status", () => {
      const error = new ProviderSignInError("could not sign in (HTTP 401)", {
        reason: "refused",
        status: 401,
      });

      expect(refusalFromThrown(error)).toEqual({ reason: "unauthorized", status: 401 });
    });

    it("reads a 503 as unavailable rather than as a wrong secret", () => {
      const error = new ProviderSignInError("could not sign in (HTTP 503)", {
        reason: "refused",
        status: 503,
      });

      expect(refusalFromThrown(error)).toEqual({ reason: "unavailable", status: 503 });
    });
  });

  describe("given a source with no credentials filled in", () => {
    it("reads it as not configured", () => {
      const error = new ProviderSignInError("needs credentials", { reason: "not_configured" });

      expect(refusalFromThrown(error)).toEqual({ reason: "not_configured", status: null });
    });
  });

  describe("given a sign-in answered without a token", () => {
    it("reads it as a malformed response", () => {
      const error = new ProviderSignInError("no access token", { reason: "malformed_response" });

      expect(refusalFromThrown(error)).toEqual({ reason: "malformed_response", status: null });
    });
  });

  describe("given a plain transport failure", () => {
    it("reads it as unreachable", () => {
      expect(refusalFromThrown(new Error("fetch failed"))).toEqual({
        reason: "unreachable",
        status: null,
      });
    });
  });
});
