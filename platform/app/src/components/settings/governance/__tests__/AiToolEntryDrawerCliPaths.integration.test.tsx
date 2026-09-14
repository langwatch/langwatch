/**
 * @vitest-environment jsdom
 *
 * The "CLI paths" section of the tile drawer, for a tool whose gateway route
 * the server forces off whatever the tile stores.
 *
 * pi ignores the base-URL environment variables the gateway route works by —
 * every model's address is fixed in pi's own build — so
 * `resolveToolPolicyOverrides` pins its allowVk to false. A switch an admin
 * can turn on while the server ignores it is worse than no switch: it reads
 * as a setting that took. Asserted with claude_code as the control, which is
 * governable on both routes and keeps a live switch. ADR-132 §7.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiToolEntry } from "~/components/me/tiles/types";

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      aiTools: {
        adminList: { invalidate: vi.fn(), setData: vi.fn() },
        list: { invalidate: vi.fn() },
      },
    }),
    aiTools: {
      providerOptions: { useQuery: () => ({ data: [], isLoading: false }) },
      routingPolicyOptions: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    departments: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", slug: "acme" },
  }),
}));

import { AiToolEntryDrawer } from "../AiToolEntryDrawer";

function codingAssistantTile(assistantKind: string): AiToolEntry {
  return {
    id: `entry-${assistantKind}`,
    organizationId: "org-1",
    slug: assistantKind,
    type: "coding_assistant",
    displayName: assistantKind,
    enabled: true,
    order: 0,
    scope: "organization",
    scopeId: "org-1",
    departmentIds: [],
    // The toggles left alone, which is what the drawer stores until an admin
    // touches them — the case where a stale `true` is most believable.
    config: { assistantKind, setupCommand: `langwatch ${assistantKind}` },
    archivedAt: null,
  } as unknown as AiToolEntry;
}

function renderDrawerFor(assistantKind: string) {
  render(
    <ChakraProvider value={defaultSystem}>
      <AiToolEntryDrawer
        organizationId="org-1"
        state={{ mode: "edit", entry: codingAssistantTile(assistantKind) }}
        onClose={vi.fn()}
      />
    </ChakraProvider>,
  );
}

function gatewaySwitchInput(): HTMLInputElement {
  const row = screen.getByText("Allow gateway (virtual key)").closest("div")
    ?.parentElement?.parentElement;
  if (!row) throw new Error("the gateway row is not rendered");
  const input = row.querySelector("input[type=checkbox]");
  if (!input) throw new Error("the gateway row carries no switch");
  return input as HTMLInputElement;
}

afterEach(() => cleanup());

describe("<AiToolEntryDrawer /> CLI paths", () => {
  describe("when the tile is a coding assistant governable on both routes", () => {
    it("offers a live gateway switch", () => {
      renderDrawerFor("claude_code");

      const input = gatewaySwitchInput();
      expect(input).not.toBeDisabled();
      expect(input).toBeChecked();
      expect(
        screen.getByText(
          "Route through the LangWatch gateway with a personal virtual key.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when the tile is a coding assistant the gateway cannot reach", () => {
    it("shows the gateway switch off, locked, and says why", () => {
      renderDrawerFor("pi");

      const input = gatewaySwitchInput();
      expect(input).toBeDisabled();
      expect(input).not.toBeChecked();
      expect(
        screen.getByText(
          "pi always calls its model provider directly, so the gateway route never applies.",
        ),
      ).toBeInTheDocument();
    });
  });
});
