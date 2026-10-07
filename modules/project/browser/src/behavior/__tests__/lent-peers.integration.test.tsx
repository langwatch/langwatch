// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { InlineCommandPaletteToken } from "@langwatch/navigation-client";
import {
  PendingJoinRequestsToken,
  ProjectDepartmentFieldToken,
} from "@langwatch/organization-client";
import { AgentActionsMenuToken } from "@langwatch/trace-client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));

import {
  AgentActionsMenu,
  InlineCommandPalette,
  PendingJoinRequests,
  ProjectDepartmentField,
} from "../lent-peers.tsx";

const peerLends = uiDeclarations([
  {
    name: "navigation",
    installation: {
      capabilities: {},
      lends: [
        {
          token: InlineCommandPaletteToken,
          load: async () => ({
            default: ({ placeholder }: { placeholder: string }) => (
              <input placeholder={placeholder} />
            ),
          }),
        },
      ],
    },
  },
  {
    name: "organization",
    installation: {
      capabilities: {},
      lends: [
        {
          token: ProjectDepartmentFieldToken,
          load: async () => ({
            default: ({ projectId }: { projectId: string }) => (
              <span>department of {projectId}</span>
            ),
          }),
        },
        {
          token: PendingJoinRequestsToken,
          load: async () => ({ default: () => <span>people are waiting to join</span> }),
        },
      ],
    },
  },
  {
    name: "trace",
    installation: {
      capabilities: {},
      lends: [
        {
          token: AgentActionsMenuToken,
          load: async () => ({
            default: ({ triggerLabel }: { triggerLabel?: string }) => (
              <button>{triggerLabel}</button>
            ),
          }),
        },
      ],
    },
  },
]);

const agentActions = {
  triggerLabel: "Set up with your agent",
  langy: null,
  copy: { label: "Copy prompt", hint: "", copiedTitle: "Copied" },
  docs: { href: "https://docs.langwatch.ai", label: "Docs", hint: "" },
};

afterEach(() => {
  cleanup();
  declarations.current = undefined;
});

describe("what navigation and organization lend project", () => {
  describe("given both are installed", () => {
    it("draws navigation's palette with the placeholder it is handed", async () => {
      declarations.current = peerLends;
      render(<InlineCommandPalette placeholder="Ask anything" />);
      expect(await screen.findByPlaceholderText("Ask anything")).toBeInTheDocument();
    });

    it("draws organization's department row for the project", async () => {
      declarations.current = peerLends;
      render(
        <ProjectDepartmentField
          organizationId="organization_1"
          projectId="project_1"
          governanceEnabled
        />,
      );
      expect(await screen.findByText("department of project_1")).toBeInTheDocument();
    });
  });

  describe("given organization lends its waiting join requests", () => {
    /** @scenario Project's home renders organization's pending join requests through its client token */
    it("draws the card where project's home places it", async () => {
      declarations.current = peerLends;
      render(<PendingJoinRequests />);
      expect(await screen.findByText("people are waiting to join")).toBeInTheDocument();
    });
  });

  describe("given no installed module lends the pending join requests token", () => {
    /** @scenario An uninstalled organization leaves project's home without the join requests card */
    it("draws nothing in the card's place, and nothing fails", () => {
      declarations.current = uiDeclarations([]);
      const { container } = render(<PendingJoinRequests />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("given neither lends", () => {
    it("draws nothing in their place", () => {
      declarations.current = uiDeclarations([]);
      const { container } = render(<InlineCommandPalette placeholder="Ask anything" />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("given trace lends its agent actions menu", () => {
    /** @scenario Project draws trace's agent actions menu through its client token */
    it("draws trace's menu with the trigger label it is handed", async () => {
      declarations.current = peerLends;
      render(<AgentActionsMenu {...agentActions} />);
      expect(
        await screen.findByRole("button", { name: "Set up with your agent" }),
      ).toBeInTheDocument();
    });
  });

  describe("given no installed module lends the agent actions menu token", () => {
    /** @scenario Project draws trace's agent actions menu through its client token */
    it("draws nothing in the menu's place", () => {
      declarations.current = uiDeclarations([]);
      const { container } = render(<AgentActionsMenu {...agentActions} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
