/**
 * @vitest-environment jsdom
 *
 * Where the install drawer says traces land once an ingestion key is issued.
 * Spec: specs/ai-gateway/governance/ingestion-templates-catalog.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/personal-workspace-feedback.ts", () => ({
  usePersonalToaster: () => ({ create: () => {} }),
}));

// The snippet highlights through shiki asynchronously; these tests read the landing copy only.
vi.mock("@langwatch/design-system/code-preview", () => ({
  SnippetPreview: () => null,
}));

import { IngestionTemplateInstallDrawer } from "../ingestion-template-install-drawer.tsx";

afterEach(cleanup);

function renderIssuedDrawer({ personalProjectSlug }: { personalProjectSlug: string | null }) {
  return renderWithDesignSystem(
    <IngestionTemplateInstallDrawer
      open
      onOpenChange={() => {}}
      template={{ slug: "acme-router", displayName: "Acme router", credentialSchema: null }}
      personalProjectSlug={personalProjectSlug}
      installResult={{ token: "sk-lw-TEST_TOKEN", endpoint: "https://app.example.com/api/otel" }}
      isInstalling={false}
      installError={null}
      hasExistingKey={false}
      onInstall={() => {}}
      onRotate={() => {}}
      onMarkInstalled={() => {}}
    />,
  );
}

describe("given the install drawer has issued an ingestion key", () => {
  describe("when the personal project slug has resolved", () => {
    /** @scenario The install drawer points at the personal project's traces page */
    it("names the personal project's traces page, filtered by the template's source", async () => {
      renderIssuedDrawer({ personalProjectSlug: "personal-jane" });

      expect(await screen.findByText("/personal-jane/traces")).toBeTruthy();
      expect(screen.getByText(/filtered by source=acme-router\./)).toBeTruthy();
      expect(screen.queryByText(/open Coding agents to find them/)).toBeNull();
    });
  });

  describe("when the personal project slug has not resolved yet", () => {
    /** @scenario The install drawer points at Coding agents before the personal project resolves */
    it("says traces land in the personal project and sends the user to Coding agents", async () => {
      renderIssuedDrawer({ personalProjectSlug: null });

      expect(
        await screen.findByText(
          /traces will land in your personal project; open Coding agents to find them\./,
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/traces will land at/)).toBeNull();
    });
  });
});
