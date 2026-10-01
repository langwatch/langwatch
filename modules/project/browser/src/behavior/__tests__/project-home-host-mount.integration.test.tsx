/**
 * @vitest-environment jsdom
 * The project home hands its onboarding snippets the deployment's address.
 * Spec: specs/features/onboarding/setup-snippet-endpoint.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const session = {
    snapshot: () => ({ scope: { status: "ready", organization: void 0, project: void 0 } }),
    currentUser: () => void 0,
    hasPermission: () => true,
    featureFlag: () => false,
  };
  const capabilities = {
    session,
    navigation: { navigate: vi.fn() },
    route: { reading: () => ({ params: {}, query: {} }) },
  };
  const deployment = {
    isSaaS: false,
    isDevelopment: false,
    appBaseUrl: "https://langwatch.acme.example",
  };
  return {
    ...original,
    useUiCapabilities: () => capabilities,
    useUiDeployment: () => deployment,
  };
});

vi.mock("../../model/langy/langy-demo-project.ts", () => ({ isLangyDemoProject: () => false }));

vi.mock("@langwatch/design-system/use-reduced-motion", () => ({ useReducedMotion: () => false }));

import { useProjectHomeHost } from "../../model/project-home-host.ts";
import ProjectHomeHostMount from "../project-home-host-mount.tsx";

function BaseHost() {
  return <output aria-label="base host">{useProjectHomeHost().deployment().baseHost}</output>;
}

afterEach(cleanup);

describe("ProjectHomeHostMount", () => {
  describe("when the installation is reached on its own address", () => {
    /** @scenario "The project home's setup snippets use the deployment's address" */
    it("hands the onboarding snippets that address", () => {
      render(
        <ProjectHomeHostMount>
          <BaseHost />
        </ProjectHomeHostMount>,
      );

      expect(screen.getByLabelText("base host")).toHaveTextContent(
        "https://langwatch.acme.example",
      );
    });
  });
});
