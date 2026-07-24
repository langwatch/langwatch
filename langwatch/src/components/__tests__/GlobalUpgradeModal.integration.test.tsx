/**
 * @vitest-environment jsdom
 *
 * GlobalUpgradeModal is the tiny, always-mounted "gate". The heavy modal body
 * lives in a separate chunk (UpgradeModalContent) that is lazy-loaded only once
 * the store opens a variant. These tests guard that split from regressing:
 *  - nothing renders while the store is closed (variant === null), and
 *  - the modal still appears (its chunk resolves and mounts) once opened.
 * This is the behaviour the lazy boundary must preserve — see UpgradeModal.tsx.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useUpgradeModalStore } from "../../stores/upgradeModalStore";
import { GlobalUpgradeModal } from "../UpgradeModal";

const renderGate = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <GlobalUpgradeModal />
    </ChakraProvider>,
  );

describe("GlobalUpgradeModal", () => {
  afterEach(() => {
    act(() => {
      useUpgradeModalStore.getState().close();
    });
  });

  describe("given no variant has been opened", () => {
    it("renders nothing", () => {
      const { container } = renderGate();
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("when the store opens a modal", () => {
    it("lazy-loads the content chunk and renders the dialog", async () => {
      renderGate();

      act(() => {
        useUpgradeModalStore.getState().openLiteMemberRestriction({});
      });

      expect(
        await screen.findByText("Feature Not Available"),
      ).toBeInTheDocument();
    });
  });
});
