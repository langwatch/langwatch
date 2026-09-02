/**
 * @vitest-environment jsdom
 *
 * The join-before-create seam (D13 ships the contract, D12 fills it):
 * a verified address goes in, an interstitial decision comes out.
 *
 * The invariant this file exists to hold is that NO organization is created
 * for anybody who did not choose to create one — so every assertion here is
 * really about which of the two actions leads, and whether anything happens
 * without a click.
 *
 * Spec: specs/identity/signin-signup-screens.feature,
 *       specs/identity/join-before-create.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { JoinLookupDecision } from "@langwatch/identity-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JoinBeforeCreateInterstitial } from "../join-before-create-interstitial";

const renderStep = (
  props: Partial<
    React.ComponentProps<typeof JoinBeforeCreateInterstitial>
  > = {},
) => {
  const onCreateWorkspace = vi.fn();
  const onJoinOrganization = vi.fn();
  const onAlreadyJoined = vi.fn();
  const result = render(
    <ChakraProvider value={defaultSystem}>
      <JoinBeforeCreateInterstitial
        verifiedEmail="sam@acme.com"
        onCreateWorkspace={onCreateWorkspace}
        onJoinOrganization={onJoinOrganization}
        onAlreadyJoined={onAlreadyJoined}
        {...props}
      />
    </ChakraProvider>,
  );
  return { ...result, onCreateWorkspace, onJoinOrganization, onAlreadyJoined };
};

const openToAcme: JoinLookupDecision = {
  outcome: "ask",
  organizations: [
    { organizationId: "org_acme", name: "Acme", colleagueCount: 10 },
  ],
};

describe("given a verified address that matches no organization", () => {
  afterEach(() => cleanup());

  describe("when sign-up reaches the join-before-create step", () => {
    /** @scenario With no match, sign-up proceeds to workspace creation */
    /** @scenario With nothing to offer, sign-up continues exactly as before */
    it("renders nothing and continues to workspace creation", async () => {
      const { container, onCreateWorkspace, onJoinOrganization } = renderStep({
        lookup: { outcome: "none" },
      });

      expect(container.innerHTML).toBe("");
      await waitFor(() => {
        expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
      });
      expect(onJoinOrganization).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization open to requests from the domain", () => {
  afterEach(() => cleanup());

  describe("when sign-up reaches the join-before-create step", () => {
    /** @scenario Sign-up offers the team before offering a workspace */
    it("leads with joining and keeps creating as the explicit secondary", async () => {
      const { onCreateWorkspace } = renderStep({ lookup: openToAcme });

      const buttons = await screen.findAllByRole("button");
      // The ORDER is the whole point: today every sign-up mints an
      // organization unconditionally, which is what leaves people alone in a
      // workspace they never chose.
      expect(buttons[0]).toHaveTextContent("Join Acme");
      expect(buttons[1]).toHaveTextContent("Create a new organization");

      // And nothing is created without a click.
      expect(onCreateWorkspace).not.toHaveBeenCalled();
    });

    it("names the organization with a rounded count and nothing more", async () => {
      renderStep({ lookup: openToAcme });

      const join = await screen.findByRole("button", { name: /Join Acme/ });
      // Spelled out, not abbreviated, and no member of Acme is named.
      expect(join).toHaveTextContent("Join Acme (10+ colleagues)");
    });
  });
});

describe("given a domain that admits verified colleagues automatically", () => {
  afterEach(() => cleanup());

  describe("when sign-up reaches the join-before-create step", () => {
    /** @scenario Automatic joining skips the step entirely */
    it("shows neither a join offer nor a workspace creation step", async () => {
      const {
        container,
        onCreateWorkspace,
        onJoinOrganization,
        onAlreadyJoined,
      } = renderStep({
        lookup: {
          outcome: "auto",
          organization: {
            organizationId: "org_acme",
            name: "Acme",
            colleagueCount: 10,
          },
        },
      });

      expect(container.innerHTML).toBe("");
      await waitFor(() => {
        expect(onAlreadyJoined).toHaveBeenCalledTimes(1);
      });
      expect(onCreateWorkspace).not.toHaveBeenCalled();
      expect(onJoinOrganization).not.toHaveBeenCalled();
    });
  });
});

describe("given a request that is already waiting on the admins", () => {
  afterEach(() => cleanup());

  describe("when the requester signs in again", () => {
    /** @scenario A waiting requester can still create a workspace, deliberately */
    it("says who it is waiting on and offers creating anyway as a plain choice", async () => {
      const { onCreateWorkspace } = renderStep({
        lookup: openToAcme,
        pendingOrganizationId: "org_acme",
      });

      expect(
        await screen.findByText(/waiting for one of their administrators/i),
      ).toBeInTheDocument();
      // Explicit, and never automatic: the request stays open either way.
      expect(
        screen.getByRole("button", {
          name: /Create a new organization anyway/,
        }),
      ).toBeInTheDocument();
      expect(onCreateWorkspace).not.toHaveBeenCalled();
      // The ask is not offered a second time.
      expect(screen.queryByRole("button", { name: /^Join / })).toBeNull();
    });
  });
});

describe("given an address the person has not verified", () => {
  afterEach(() => cleanup());

  describe("when the sign-up flow reaches this point", () => {
    /** @scenario The step never runs before the address is verified */
    it("offers nothing, and no organization name reaches the browser", async () => {
      const { container, onJoinOrganization } = renderStep({
        verified: false,
        // Even handed an answer, an unverified address renders nothing: the
        // gate is the verification, not the absence of a lookup.
        lookup: openToAcme,
      });

      expect(container.innerHTML).toBe("");
      expect(container.innerHTML).not.toContain("Acme");
      expect(onJoinOrganization).not.toHaveBeenCalled();
    });
  });
});

describe("given a verified address on a public email provider", () => {
  afterEach(() => cleanup());

  describe("when a lookup somehow answers with an organization", () => {
    it("still renders nothing, as a second independent guard", async () => {
      const { container } = renderStep({
        verifiedEmail: "sam@gmail.com",
        lookup: openToAcme,
      });

      // The server enforces this too. Two independent places have to fail
      // before strangers are offered to each other.
      expect(container.innerHTML).toBe("");
    });
  });
});
