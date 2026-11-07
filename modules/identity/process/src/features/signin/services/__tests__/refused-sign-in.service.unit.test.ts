/** @see specs/identity/idp-refused-sign-in.feature */
import {
  emptySsoConnection,
  SsoConnectionNotFoundError,
  type SignInIdpKind,
  type SsoConnectionState,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { RefusedSignInService, type RefusedSignInSeats } from "../refused-sign-in.service.ts";

const CONNECTION = "ssoc_acme";

function connection(overrides: Partial<SsoConnectionState> = {}): SsoConnectionState {
  const empty = emptySsoConnection({ connectionId: CONNECTION });
  return {
    ...empty,
    organizationId: "org_acme",
    type: "oidc",
    state: "ACTIVE",
    verifiedDomains: ["acme.com"],
    idpMetadata: { ...empty.idpMetadata, issuer: "https://acme.okta.com", providerId: "acme" },
    ...overrides,
  };
}

function world({
  state = connection(),
  outcome = "refused",
}: { state?: SsoConnectionState | "missing"; outcome?: "seat_limit" | "refused" } = {}) {
  const recorded: { organizationId: string; email: string; idp: SignInIdpKind }[] = [];
  const seats: RefusedSignInSeats = {
    recordRefusedSignIn: async (input) => {
      recorded.push(input);
      return { outcome };
    },
  };
  const service = RefusedSignInService.create({
    connections: {
      getConnection: async () => {
        if (state === "missing") throw new SsoConnectionNotFoundError("none");
        return state;
      },
    },
    seats,
  });
  return { service, recorded };
}

const byConnection = { kind: "connection", connectionId: CONNECTION } as const;

describe("RefusedSignInService", () => {
  describe("given a connection to Okta on a verified domain", () => {
    describe("when the organization would hold the address for a seat", () => {
      /** @scenario "A refused person the organization would hold for a seat sees the seat-limit screen first" */
      it("records the refusal and answers seat_limit", async () => {
        const { service, recorded } = world({ outcome: "seat_limit" });

        const verdict = await service.classify({
          refusedBy: byConnection,
          email: " New.Hire@ACME.com ",
        });

        expect(verdict).toEqual({ organizationId: "org_acme", idp: "okta", outcome: "seat_limit" });
        expect(recorded).toEqual([
          { organizationId: "org_acme", email: "new.hire@acme.com", idp: "okta" },
        ]);
      });
    });

    describe("when a seat is free", () => {
      /** @scenario "A refused person at an organization with seats free is told the provider refused" */
      it("answers refused with the kind", async () => {
        const verdict = await world().service.classify({
          refusedBy: byConnection,
          email: "new.hire@acme.com",
        });

        expect(verdict).toEqual({ organizationId: "org_acme", idp: "okta", outcome: "refused" });
      });
    });

    describe("when no address is known", () => {
      /** @scenario "Without a known address nobody is told and no seat is requested" */
      it("records nothing", async () => {
        const { service, recorded } = world({ outcome: "seat_limit" });

        const verdict = await service.classify({ refusedBy: byConnection, email: null });

        expect(verdict.outcome).toBe("refused");
        expect(verdict.idp).toBe("okta");
        expect(recorded).toEqual([]);
      });
    });

    describe("when the address is outside the connection's verified domains", () => {
      /** @scenario "An address outside the connection's verified domains is not recorded" */
      it("records nothing", async () => {
        const { service, recorded } = world({ outcome: "seat_limit" });

        const verdict = await service.classify({
          refusedBy: byConnection,
          email: "someone@elsewhere.com",
        });

        expect(verdict.outcome).toBe("refused");
        expect(recorded).toEqual([]);
      });
    });
  });

  describe("given a connection whose issuer is no provider we recognise", () => {
    /** @scenario "A provider of a kind we do not name is called the company's sign-in" */
    it.each([
      ["oidc", "https://idp.acme.example"],
      ["saml", null],
    ] as const)("answers the %s protocol as the kind", async (type, issuer) => {
      const state = connection({ type });
      state.idpMetadata = { ...state.idpMetadata, issuer };

      const verdict = await world({ state }).service.classify({
        refusedBy: byConnection,
        email: null,
      });

      expect(verdict.idp).toBe(type);
    });
  });

  describe("given issuers of the providers we name", () => {
    it.each([
      ["https://login.microsoftonline.com/tenant/v2.0", "entra"],
      ["https://sts.windows.net/tenant/", "entra"],
      ["https://accounts.google.com", "google"],
      ["https://acme.onelogin.com/oidc/2", "onelogin"],
      ["https://oauth.id.jumpcloud.com/", "jumpcloud"],
      ["https://auth.pingone.eu/env/as", "ping"],
      ["https://acme.eu.auth0.com/", "auth0"],
      ["http://www.okta.com/exk123", "okta"],
      ["https://notokta.com", "oidc"],
    ])("names %s as %s", async (issuer, kind) => {
      const state = connection();
      state.idpMetadata = { ...state.idpMetadata, issuer };

      const verdict = await world({ state }).service.classify({
        refusedBy: byConnection,
        email: null,
      });

      expect(verdict.idp).toBe(kind);
    });
  });

  describe("given an installation provider", () => {
    it.each([
      ["okta", "okta"],
      ["microsoft", "entra"],
      ["github", null],
    ])("names %s and records nothing", async (providerId, kind) => {
      const { service, recorded } = world({ outcome: "seat_limit" });

      const verdict = await service.classify({
        refusedBy: { kind: "provider", providerId },
        email: "sam@acme.com",
      });

      expect(verdict).toEqual({ organizationId: null, idp: kind, outcome: "refused" });
      expect(recorded).toEqual([]);
    });
  });

  describe("given a connection id nobody registered", () => {
    it("answers an unnamed refusal", async () => {
      const verdict = await world({ state: "missing" }).service.classify({
        refusedBy: byConnection,
        email: "sam@acme.com",
      });

      expect(verdict).toEqual({ organizationId: null, idp: null, outcome: "refused" });
    });
  });
});
