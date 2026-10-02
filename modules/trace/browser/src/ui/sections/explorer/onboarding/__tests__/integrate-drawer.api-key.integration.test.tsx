/**
 * @vitest-environment jsdom
 * The integrate drawer mints two tokens, each on its own click: ingestion for `.env`,
 * project reads for the MCP config. Spec: specs/api-keys/api-keys-v2.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "demo", name: "Demo" },
    organization: { id: "org_1", name: "ACME" },
  }),
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUiDeployment: () => ({ isSaaS: true, isDevelopment: false, appBaseUrl: "" }),
}));

// Both snippets render through CodePreview; its text is what a reader copies.
vi.mock("../../../onboarding/observability/code-preview.tsx", () => ({
  CodePreview: ({ code, filename }: { code: string; filename: string }) => (
    <div data-testid={filename}>{code}</div>
  ),
}));

vi.mock("../../../onboarding/via-claude-code-screen.tsx", () => ({
  PromptList: () => null,
  SkillList: () => null,
  TRACING_SKILL_ID: "tracing",
}));
vi.mock("../../../../elements/explorer/onboarding/sdk-setup.tsx", () => ({ SdkSetup: () => null }));

// The hook's own suite covers scoping and the ingestion default; this double records grants.
const minted = vi.hoisted(() => ({ permissions: [] as (readonly string[] | undefined)[] }));
const PROJECT_READS = vi.hoisted(() => ["project:view", "traces:view"]);
const ENV_TOKEN = "lw-pat-env-fixture-not-a-real-token-0000";
const MCP_TOKEN = "lw-pat-mcp-fixture-not-a-real-token-0000";
vi.mock("@langwatch/api-key-client", () => ({
  PROJECT_READ_PERMISSIONS: PROJECT_READS,
  useMintPersonalToken: ({ permissions }: { permissions?: readonly string[] }) =>
    useMintDouble(permissions),
}));

function useMintDouble(permissions: readonly string[] | undefined) {
  const [token, setToken] = useState<string>();
  return {
    token,
    isMinting: false,
    scopeNote: "",
    mint: async () => {
      minted.permissions.push(permissions);
      const answer = permissions ? MCP_TOKEN : ENV_TOKEN;
      setToken(answer);
      return answer;
    },
  };
}

import { IntegrateDrawer } from "../integrate-drawer.tsx";

afterEach(() => {
  cleanup();
  minted.permissions = [];
});

describe("IntegrateDrawer tokens", () => {
  describe("when the reader creates a token for .env and another on the MCP tab", () => {
    /** @scenario The traces integrate drawer mints an ingestion token for .env and a reads token for MCP */
    it("mints ingestion only for .env and project reads only for the MCP config", async () => {
      renderWithDesignSystem(<IntegrateDrawer open onOpenChange={vi.fn()} />);

      fireEvent.click(
        await screen.findByRole("button", { name: "Create a personal access token" }),
      );
      await waitFor(() => expect(screen.getByTestId(".env")).toHaveTextContent(ENV_TOKEN));
      expect(minted.permissions).toEqual([undefined]);

      fireEvent.keyDown(window, { key: "m" });
      expect(screen.getByTestId("mcp.json")).not.toHaveTextContent(ENV_TOKEN);
      fireEvent.click(
        await screen.findByRole("button", { name: "Create a personal access token" }),
      );

      await waitFor(() => expect(screen.getByTestId("mcp.json")).toHaveTextContent(MCP_TOKEN));
      expect(minted.permissions).toEqual([undefined, PROJECT_READS]);
      expect(screen.getByTestId(".env")).toHaveTextContent(ENV_TOKEN);
    });
  });
});
