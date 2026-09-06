import { describe, expect, it, vi } from "vitest";
import {
  type CallbackAssertion,
  type CallbackUserMatch,
  SignInCallbackLinkingService,
} from "../signin-callback-linking.service";

const ASSERTION: CallbackAssertion = {
  connectionId: "conn_acme",
  provider: "oidc",
  subject: "okta|000111",
  email: "Sam.J+news@Acme.com",
  emailVerified: true,
  allowsJit: true,
};

function candidate(
  overrides: Partial<CallbackUserMatch> = {},
): CallbackUserMatch {
  return {
    userId: "user_sam",
    holdsVerifiedEmail: true,
    identifierDomains: ["acme.com"],
    ...overrides,
  };
}

function build({
  bySubject = null,
  byEmail = [],
}: {
  bySubject?: { userId: string } | null;
  byEmail?: readonly CallbackUserMatch[];
} = {}) {
  const directory = {
    findUserByProviderSubject: vi.fn().mockResolvedValue(bySubject),
    findUsersByEmail: vi.fn().mockResolvedValue(byEmail),
    linkProviderAccount: vi.fn().mockResolvedValue(undefined),
    provisionUser: vi.fn().mockResolvedValue({ userId: "user_new" }),
  };
  const proposals = { proposeLink: vi.fn().mockResolvedValue([]) };
  const audit = { linkAttempted: vi.fn(), linkRecorded: vi.fn() };
  let minted = 0;
  const service = new SignInCallbackLinkingService({
    directory,
    proposals,
    audit,
    clock: {
      now: () => 1_700_000_000_000,
      newCommandId: () => `cmd_${(minted += 1)}`,
    },
    newProposalId: () => "proposal_1",
  });
  return { service, directory, proposals, audit };
}

describe("the SSO callback's linking decision", () => {
  describe("given a user whose identifier matches the connection and subject", () => {
    /** @scenario "A known provider subject signs straight in" */
    it("signs them in without creating a link or emitting an event", async () => {
      const { service, directory, proposals } = build({
        bySubject: { userId: "user_sam" },
      });

      await expect(service.complete(ASSERTION)).resolves.toEqual({
        kind: "signed_in",
        userId: "user_sam",
        linked: false,
      });

      expect(directory.linkProviderAccount).not.toHaveBeenCalled();
      expect(directory.findUsersByEmail).not.toHaveBeenCalled();
      expect(proposals.proposeLink).not.toHaveBeenCalled();
    });
  });

  describe("given exactly one user holding the asserted address as VERIFIED", () => {
    /** @scenario "An unambiguous verified match is auto-linked with an audit trail" */
    it("attaches the identifier through the pipeline and signs the user in", async () => {
      const { service, directory, proposals } = build({
        byEmail: [candidate()],
      });

      await expect(service.complete(ASSERTION)).resolves.toEqual({
        kind: "linked",
        userId: "user_sam",
        linked: true,
      });

      // Through better-auth's own account creation, which fires the ceremony
      // that attaches. Never a hand-written row.
      expect(directory.linkProviderAccount).toHaveBeenCalledWith({
        userId: "user_sam",
        connectionId: "conn_acme",
        provider: "oidc",
        subject: "okta|000111",
        normalizedEmail: "sam.j+news@acme.com",
      });
      expect(proposals.proposeLink).not.toHaveBeenCalled();
    });

    /** @scenario "An unambiguous verified match is auto-linked with an audit trail" */
    it("records a before and an after audit event, carrying the domain only", async () => {
      const { service, audit } = build({ byEmail: [candidate()] });

      await service.complete(ASSERTION);

      const record = {
        userId: "user_sam",
        connectionId: "conn_acme",
        provider: "oidc",
        subject: "okta|000111",
        domain: "acme.com",
      };
      expect(audit.linkAttempted).toHaveBeenCalledWith(record);
      expect(audit.linkRecorded).toHaveBeenCalledWith(record);
      // The domain, never the local part: "sam.j" appears nowhere.
      expect(JSON.stringify(record)).not.toContain("sam.j");
    });

    it("leaves the attempt standing and records no completion when the link fails", async () => {
      const { service, directory, audit } = build({ byEmail: [candidate()] });
      directory.linkProviderAccount.mockRejectedValue(new Error("nope"));

      await expect(service.complete(ASSERTION)).rejects.toThrow();

      expect(audit.linkAttempted).toHaveBeenCalledTimes(1);
      expect(audit.linkRecorded).not.toHaveBeenCalled();
    });
  });

  describe("given a row holding the address with no verification evidence", () => {
    /** @scenario "An unverified orphan is never auto-linked" */
    it("creates no link, records a proposal, and refuses with guidance", async () => {
      const { service, directory, proposals } = build({
        byEmail: [candidate({ holdsVerifiedEmail: false })],
      });

      await expect(service.complete(ASSERTION)).rejects.toMatchObject({
        code: "identity_link_proposed",
      });

      expect(directory.linkProviderAccount).not.toHaveBeenCalled();
      expect(proposals.proposeLink).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "user_sam",
          userId: "user_sam",
          reason: "unverified_orphan",
          value: "sam.j+news@acme.com",
          providerAccountId: "okta|000111",
        }),
      );
    });

    /** @scenario "An unverified orphan is never auto-linked" */
    it("refuses the same way when the IdP itself asserts nothing verified", async () => {
      const { service, proposals } = build({ byEmail: [candidate()] });

      await expect(
        service.complete({ ...ASSERTION, emailVerified: false }),
      ).rejects.toMatchObject({ code: "identity_link_proposed" });

      expect(proposals.proposeLink).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "unverified_orphan" }),
      );
    });
  });

  describe("given a match the organization cannot fully vouch for", () => {
    /** @scenario "An ambiguous match becomes a proposal, not a guess" */
    it("records a LinkProposed event and refuses with guidance", async () => {
      const { service, proposals, directory } = build({
        byEmail: [
          candidate({ identifierDomains: ["acme.com", "personal.example"] }),
        ],
      });

      await expect(service.complete(ASSERTION)).rejects.toMatchObject({
        code: "identity_link_proposed",
      });

      expect(proposals.proposeLink).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "unvouched_identifiers" }),
      );
      expect(directory.linkProviderAccount).not.toHaveBeenCalled();
    });

    /** @scenario "An ambiguous match becomes a proposal, not a guess" */
    it("proposes against every candidate rather than guessing one", async () => {
      const { service, proposals } = build({
        byEmail: [
          candidate({ userId: "user_sam" }),
          candidate({ userId: "user_other" }),
        ],
      });

      await expect(service.complete(ASSERTION)).rejects.toMatchObject({
        code: "identity_link_proposed",
      });

      expect(proposals.proposeLink.mock.calls.map(([data]) => data.userId)).toEqual(
        ["user_sam", "user_other"],
      );
    });

    /** @scenario "An ambiguous match becomes a proposal, not a guess" */
    it("attaches the identifier and admits the user once the proposal is confirmed", async () => {
      const { service, directory, audit } = build();

      await expect(
        service.confirmProposal({
          assertion: ASSERTION,
          userId: "user_sam",
        }),
      ).resolves.toEqual({ kind: "linked", userId: "user_sam", linked: true });

      expect(directory.linkProviderAccount).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_sam" }),
      );
      expect(audit.linkRecorded).toHaveBeenCalled();
    });
  });

  describe("given a subject and address matching nobody", () => {
    /** @scenario "No match provisions just-in-time only where the connection allows" */
    it("provisions and signs in on a connection that allows it", async () => {
      const { service, directory } = build();

      await expect(service.complete(ASSERTION)).resolves.toEqual({
        kind: "provisioned",
        userId: "user_new",
        linked: true,
      });

      expect(directory.provisionUser).toHaveBeenCalledWith({
        connectionId: "conn_acme",
        provider: "oidc",
        subject: "okta|000111",
        normalizedEmail: "sam.j+news@acme.com",
      });
    });

    /** @scenario "No match provisions just-in-time only where the connection allows" */
    it("refuses with jit_disabled on a connection that forbids it", async () => {
      const { service, directory } = build();

      await expect(
        service.complete({ ...ASSERTION, allowsJit: false }),
      ).rejects.toMatchObject({ code: "identity_jit_disabled" });

      expect(directory.provisionUser).not.toHaveBeenCalled();
    });
  });
});
