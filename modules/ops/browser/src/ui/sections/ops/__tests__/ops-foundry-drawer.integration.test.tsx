/** @vitest-environment jsdom */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../behavior/ops-api.ts", () => ({
  api: { organization: { getAll: { useQuery: () => ({ data: [] }) } } },
}));
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    useUtils: () => ({ prompts: { getAllPromptsForProject: { fetch: async () => [] } } }),
  },
}));
vi.mock("@langwatch/api-key-client", () => ({
  apiKeyClient: {
    apiKey: {
      create: { useMutation: () => ({ mutateAsync: vi.fn(), reset: vi.fn() }) },
    },
  },
  personalTokenInput: () => ({}),
}));

import { renderWithOpsHost } from "../../../../testing.tsx";
import OpsFoundryDrawer from "../ops-foundry-drawer.tsx";

afterEach(cleanup);

describe("the routed foundry drawer", () => {
  describe("when the palette opens it outside the Foundry page", () => {
    it("renders with its own runtime instead of throwing", async () => {
      renderWithOpsHost(<OpsFoundryDrawer onClose={vi.fn()} />);

      expect(await screen.findByText("The Foundry")).toBeTruthy();
    });
  });
});
