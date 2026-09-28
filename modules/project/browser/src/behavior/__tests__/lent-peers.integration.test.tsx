// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));

import { InlineCommandPalette, ProjectDepartmentField } from "../lent-peers.tsx";

const peerLends = uiDeclarations([
  {
    name: "navigation",
    installation: {
      capabilities: {
        inlineCommandPalette: {
          load: async () => ({
            default: ({ placeholder }: { placeholder: string }) => (
              <input placeholder={placeholder} />
            ),
          }),
        },
      },
    },
  },
  {
    name: "organization",
    installation: {
      capabilities: {
        projectDepartmentField: {
          load: async () => ({
            default: ({ projectId }: { projectId: string }) => (
              <span>department of {projectId}</span>
            ),
          }),
        },
      },
    },
  },
]);

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

  describe("given neither lends", () => {
    it("draws nothing in their place", () => {
      declarations.current = uiDeclarations([]);
      const { container } = render(<InlineCommandPalette placeholder="Ask anything" />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
