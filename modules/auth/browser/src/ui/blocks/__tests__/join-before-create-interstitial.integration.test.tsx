/**
 * @vitest-environment jsdom
 * Join-before-create interstitial: no org created without user choice.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { JoinLookupDecision } from "@langwatch/identity-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JoinBeforeCreateInterstitial } from "../join-before-create-interstitial.tsx";

const renderStep = (
  props: Partial<React.ComponentProps<typeof JoinBeforeCreateInterstitial>> = {},
) => {
  const onCreateWorkspace = vi.fn();
  const onJoinOrganization = vi.fn();
  const onAlreadyJoined = vi.fn();
  const result = renderWithDesignSystem(
    <JoinBeforeCreateInterstitial
      verifiedEmail="sam@acme.com"
      onCreateWorkspace={onCreateWorkspace}
      onJoinOrganization={onJoinOrganization}
      onAlreadyJoined={onAlreadyJoined}
      {...props}
    />,
  );
  return { ...result, onCreateWorkspace, onJoinOrganization, onAlreadyJoined };
};

const openToAcme: JoinLookupDecision = {
  outcome: "ask",
  organizations: [{ organizationId: "org_acme", name: "Acme", colleagueCount: 10 }],
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

const openToMany = (count: number): JoinLookupDecision => ({
  outcome: "ask",
  organizations: Array.from({ length: count }, (_, index) => ({
    organizationId: `org_${index}`,
    name: index === 0 ? "Acme" : `Acme team ${index}`,
    colleagueCount: index === 0 ? 10 : 1,
  })),
});

describe("given many organizations open to requests from the domain", () => {
  afterEach(() => cleanup());

  describe("when sign-up reaches the join-before-create step", () => {
    /** @scenario Many organizations stay one clear choice and a short list */
    it("keeps one primary action and folds the rest behind a toggle", async () => {
      renderStep({ lookup: openToMany(12) });

      expect(
        await screen.findByRole("button", { name: "Join Acme (10+ colleagues)" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Join Acme team 1" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Join Acme team 3" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Join Acme team 4" })).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.getByRole("button", { name: "Create a new organization" })).toBeInTheDocument();
    });

    it("lists and filters every organization once asked to show all", async () => {
      const user = userEvent.setup();
      const { onJoinOrganization } = renderStep({ lookup: openToMany(12) });

      await user.click(await screen.findByRole("button", { name: "Show all 11 organizations" }));
      expect(screen.getByRole("button", { name: "Join Acme team 11" })).toBeInTheDocument();

      await user.type(screen.getByRole("textbox", { name: "Search organizations" }), "team 11");
      expect(screen.queryByRole("button", { name: "Join Acme team 1" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Join Acme team 10" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Join Acme team 11" }));
      expect(onJoinOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ id: "org_11", name: "Acme team 11" }),
      );
    });
  });

  describe("when only a few other organizations are open", () => {
    /** @scenario A few organizations list as rows with nothing to unfold */
    it("lists every other organization as a row with no toggle and no filter", async () => {
      renderStep({ lookup: openToMany(4) });

      expect(
        await screen.findByRole("button", { name: "Join Acme (10+ colleagues)" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /^Join Acme team/ })).toHaveLength(3);
      expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });

  describe("when the name filter matches nothing", () => {
    let user: ReturnType<typeof userEvent.setup>;

    beforeEach(async () => {
      user = userEvent.setup();
      renderStep({ lookup: openToMany(12) });
      await user.click(await screen.findByRole("button", { name: "Show all 11 organizations" }));
      await user.type(screen.getByRole("textbox", { name: "Search organizations" }), "globex");
    });

    /** @scenario A name filter that matches nothing says so and folds back cleanly */
    it("says no organization matches and offers to clear the search", async () => {
      expect(screen.getByText('No organization matches "globex".')).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Join Acme team/ })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Clear search" }));
      expect(screen.getByRole("textbox", { name: "Search organizations" })).toHaveValue("");
      expect(screen.getByRole("button", { name: "Join Acme team 11" })).toBeInTheDocument();
    });

    it("folds back to three rows and clears the query on Show fewer", async () => {
      await user.click(screen.getByRole("button", { name: "Show fewer" }));

      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByText(/No organization matches/)).toBeNull();
      expect(screen.getAllByRole("button", { name: /^Join Acme team/ })).toHaveLength(3);

      await user.click(screen.getByRole("button", { name: "Show all 11 organizations" }));
      expect(screen.getByRole("textbox", { name: "Search organizations" })).toHaveValue("");
    });
  });
});

describe("given a domain that admits verified colleagues automatically", () => {
  afterEach(() => cleanup());

  describe("when sign-up reaches the join-before-create step", () => {
    /** @scenario Automatic joining skips the step entirely */
    it("shows neither a join offer nor a workspace creation step", async () => {
      const { container, onCreateWorkspace, onJoinOrganization, onAlreadyJoined } = renderStep({
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
