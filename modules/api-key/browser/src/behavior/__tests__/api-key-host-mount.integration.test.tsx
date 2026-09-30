/**
 * @vitest-environment jsdom
 * The API keys page snippets name the deployment's address, not the cloud one.
 * Spec: specs/features/onboarding/setup-snippet-endpoint.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { deployment } = vi.hoisted(() => ({
  deployment: { appBaseUrl: "https://langwatch.acme.example", isSaaS: false },
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const session = {
    currentUser: () => ({ id: "user_1" }),
    hasPermission: () => true,
    isSettled: () => true,
  };
  const capabilities = {
    session,
    navigation: { navigate: vi.fn(), replace: vi.fn() },
    route: { reading: () => ({ params: {}, query: {} }), setQuery: vi.fn() },
    feedback: { succeeded: vi.fn(), failed: vi.fn() },
  };
  const scope = { activeScope: () => ({ organizationId: "org_1", projectId: "proj_1" }) };
  return {
    ...original,
    useUiCapabilities: () => capabilities,
    useUiScope: () => scope,
    useUiDeployment: () => deployment,
  };
});

vi.mock("@langwatch/browser-host/address", () => ({ useUiAddress: () => "/settings/api-keys" }));
const drawer = { openDrawer: vi.fn() };
vi.mock("@langwatch/browser-host/use-drawer", () => ({ useDrawer: () => drawer }));
const graph = { organization: void 0, activeProject: void 0 };
vi.mock("../api-key-organization-graph.ts", () => ({ useApiKeyOrganizationGraph: () => graph }));

import ApiKeyHostMount from "../api-key-host-mount.tsx";
import { useApiKeyHost } from "../../model/api-key-host.ts";

function Endpoint() {
  return <output aria-label="endpoint">{useApiKeyHost().apiEndpoint()}</output>;
}

afterEach(cleanup);

describe("ApiKeyHostMount", () => {
  describe("when the installation is reached on its own address", () => {
    /** @scenario "The API keys page snippets use the deployment's address" */
    it("hands the snippets that address", () => {
      render(
        <ApiKeyHostMount>
          <Endpoint />
        </ApiKeyHostMount>,
      );

      expect(screen.getByLabelText("endpoint")).toHaveTextContent(
        "https://langwatch.acme.example",
      );
    });
  });
});
