/**
 * @vitest-environment jsdom
 *
 * What the install drawer says before a rotation. A source can be installed
 * on several machines at once and a rotation kills every one of them, so the
 * count and the machine names are the copy, not a detail.
 *
 * @see specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import { IngestionTemplateInstallDrawer } from "../IngestionTemplateInstallDrawer";

function renderDrawer(installedOn: (string | null)[]) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <IngestionTemplateInstallDrawer
        open
        onOpenChange={vi.fn()}
        template={{
          slug: "claude_cowork",
          displayName: "Claude Cowork",
          description: null,
          credentialSchema: null,
        }}
        installResult={null}
        isInstalling={false}
        installError={null}
        installedOn={installedOn}
        onInstall={vi.fn()}
        onRotate={vi.fn()}
        onMarkInstalled={vi.fn()}
      />
    </ChakraProvider>,
  );
}

describe("IngestionTemplateInstallDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given the source is installed on two machines, one without a label", () => {
    /** @scenario "Rotate says how many keys it revokes and which machines hold them" */
    it("names both machines, says how many keys go, and puts the count on the button", () => {
      renderDrawer(["MacBook Pro", null]);

      expect(
        screen.getByText(
          "Rotating revokes the 2 keys for this source (MacBook Pro, unknown device). Paste the new token wherever you wired the old one.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Rotate token (revokes 2)" }),
      ).toBeInTheDocument();
    });
  });

  describe("given the source is installed on one machine", () => {
    it("says one key in the singular", () => {
      renderDrawer(["build-server"]);

      expect(
        screen.getByText(
          "Rotating revokes the 1 key for this source (build-server). Paste the new token wherever you wired the old one.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Rotate token (revokes 1)" }),
      ).toBeInTheDocument();
    });
  });

  describe("given the source is not connected yet", () => {
    it("offers the template rather than a rotation", () => {
      renderDrawer([]);

      expect(
        screen.getByRole("button", { name: "Use this template" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Rotating revokes/)).not.toBeInTheDocument();
    });
  });
});
