/**
 * @vitest-environment jsdom
 *
 * The join-before-create seam (D13 ships the contract, D12 fills it):
 * a verified address goes in, an interstitial decision comes out. With
 * nothing to offer it renders nothing at all and sign-up carries on, which is
 * what makes D12 additive.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JoinBeforeCreateInterstitial } from "../JoinBeforeCreateInterstitial";

describe("given a verified address that matches no organization", () => {
  afterEach(() => cleanup());

  describe("when sign-up reaches the join-before-create step", () => {
    /** @scenario With no match, sign-up proceeds to workspace creation */
    it("renders nothing and continues to workspace creation", async () => {
      const onCreateWorkspace = vi.fn();
      const onJoinOrganization = vi.fn();

      const { container } = render(
        <ChakraProvider value={defaultSystem}>
          <JoinBeforeCreateInterstitial
            verifiedEmail="sam@acme.com"
            onCreateWorkspace={onCreateWorkspace}
            onJoinOrganization={onJoinOrganization}
          />
        </ChakraProvider>,
      );

      expect(container.innerHTML).toBe("");
      await waitFor(() => {
        expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
      });
      expect(onJoinOrganization).not.toHaveBeenCalled();
    });
  });
});
