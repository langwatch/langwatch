/**
 * @vitest-environment jsdom
 *
 * "How do I verify a domain?", answered on the access page.
 *
 * Spec: specs/identity/org-access-cluster.feature,
 *       specs/identity/sso-domain-verification.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  setup: null as unknown,
}));

vi.mock("~/utils/api", () => ({
  api: {
    ssoSetup: {
      getSetup: {
        useQuery: () => ({
          data: state.setup,
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

const { DomainVerificationSection } = await import(
  "../DomainVerificationSection"
);

function renderSection({ canView = true } = {}) {
  return render(
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <DomainVerificationSection
          organizationId="org_acme"
          canView={canView}
        />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

describe("given an organization's domains", () => {
  beforeEach(() => {
    state.setup = {
      connection: {
        verifiedDomains: ["acme.com"],
        domainProofs: [
          {
            domain: "acme.com",
            proofState: "VERIFIED",
            graceEndsAtMs: null,
          },
        ],
      },
      claims: [
        { domain: "acme.com", state: "APPROVED", waitsForReview: false },
        { domain: "acme.co.uk", state: "WAITING", waitsForReview: false },
      ],
    };
  });
  afterEach(() => cleanup());

  describe("when an administrator reads the access page", () => {
    /** @scenario Verifying a domain is answerable from here */
    it("says which domains are proved and which are not, and offers the way", () => {
      renderSection();

      expect(screen.getByText("acme.com")).toBeInTheDocument();
      expect(screen.getByText("Proved")).toBeInTheDocument();
      expect(screen.getByText("acme.co.uk")).toBeInTheDocument();
      // A waiting claim on the zero-touch tier is waiting for the CUSTOMER,
      // so it says what they have to do rather than implying we are busy.
      expect(screen.getByText("Not proved yet")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Prove a domain/ }),
      ).toBeInTheDocument();
    });

    /** @scenario The two ways a domain matters are told apart */
    it("keeps joining by domain and proving for sign-on apart", () => {
      renderSection();

      const section = screen.getByTestId("domain-verification-section");
      expect(section.textContent).toContain(
        "is what lets colleagues on it join automatically",
      );
      expect(section.textContent).toContain(
        "only needs one of your members to hold a verified address",
      );
      expect(section.textContent).toContain(
        "you approve each request yourself",
      );
    });

    /** @scenario "A record that has gone missing starts a clock and changes nothing else" */
    it("shows a missing record as a warning with its deadline, not as a failure", () => {
      const deadline = Date.UTC(2026, 7, 27, 9, 0, 0);
      state.setup = {
        connection: {
          verifiedDomains: ["acme.com"],
          domainProofs: [
            {
              domain: "acme.com",
              proofState: "WAVERING",
              graceEndsAtMs: deadline,
            },
          ],
        },
        claims: [
          { domain: "acme.com", state: "APPROVED", waitsForReview: false },
        ],
      };
      renderSection();

      const chip = screen.getByText("Record not found");
      expect(chip).toBeInTheDocument();
      expect(screen.queryByText("Proved")).toBeNull();
      // Nothing has changed yet, and the chip says so along with the date.
      expect(chip.getAttribute("title")).toContain("Nothing has changed yet");
    });

    /** @scenario "A lapse stops new people and stops nobody who is already here" */
    it("shows a lapsed domain distinctly and says existing people are unaffected", () => {
      state.setup = {
        connection: {
          verifiedDomains: ["acme.com"],
          domainProofs: [
            {
              domain: "acme.com",
              proofState: "LAPSED",
              graceEndsAtMs: null,
            },
          ],
        },
        claims: [
          { domain: "acme.com", state: "APPROVED", waitsForReview: false },
        ],
      };
      renderSection();

      const chip = screen.getByText("Record missing");
      expect(chip).toBeInTheDocument();
      expect(screen.queryByText("Record not found")).toBeNull();
      expect(screen.queryByText("Proved")).toBeNull();
      expect(chip.getAttribute("title")).toContain(
        "Everyone already here signs in as usual",
      );
    });

    /** @scenario "A claim on a domain another organization proved waits for a person" */
    it("says a contested claim is with us, and an ordinary one is with them", () => {
      state.setup = {
        connection: { verifiedDomains: [], domainProofs: [] },
        claims: [
          { domain: "acme.com", state: "WAITING", waitsForReview: true },
        ],
      };
      renderSection();

      expect(screen.getByText("Waiting for review")).toBeInTheDocument();
      expect(screen.queryByText("Not proved yet")).toBeNull();
    });

    /** @scenario Verifying a domain is answerable from here */
    it("says no domain has been claimed rather than showing an empty panel", () => {
      state.setup = { connection: null, claims: [] };
      renderSection();

      expect(screen.getByTestId("domains-empty")).toBeInTheDocument();
    });
  });

  describe("when the reader may not see single sign-on", () => {
    /** @scenario Verifying a domain is answerable from here */
    it("says who can tell them, rather than showing a failure", () => {
      renderSection({ canView: false });

      expect(screen.getByTestId("domains-no-access")).toBeInTheDocument();
      expect(screen.queryByTestId("section-error-notice")).toBeNull();
    });
  });
});
