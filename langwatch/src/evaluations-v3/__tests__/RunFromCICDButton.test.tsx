/**
 * @vitest-environment jsdom
 *
 * Tests for RunFromCICDButton component.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunFromCICDButton } from "../components/RunFromCICDButton";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Mock the useOrganizationTeamProject hook
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("RunFromCICDButton", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
    // Set up experiment slug for the component to render
    useEvaluationsV3Store.setState({ experimentSlug: "test-evaluation" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders when experimentSlug is set", () => {
      render(<RunFromCICDButton />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /ci\/cd/i });
      expect(button).toBeInTheDocument();
    });

    it("does not render when experimentSlug is not set", () => {
      useEvaluationsV3Store.setState({ experimentSlug: undefined });
      render(<RunFromCICDButton />, { wrapper: Wrapper });

      const button = screen.queryByRole("button", { name: /ci\/cd/i });
      expect(button).not.toBeInTheDocument();
    });

    it("is disabled when disabled prop is true", () => {
      render(<RunFromCICDButton disabled />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /ci\/cd/i });
      expect(button).toBeDisabled();
    });
  });

  describe("Dialog", () => {
    it("opens dialog when clicking the button", async () => {
      const user = userEvent.setup();
      render(<RunFromCICDButton />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /ci\/cd/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Run from CI/CD")).toBeInTheDocument();
      });
    });

    it("shows API key setup link in the dialog", async () => {
      const user = userEvent.setup();
      render(<RunFromCICDButton />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /ci\/cd/i });
      await user.click(button);

      await waitFor(() => {
        // Should show link to find API key
        expect(screen.getByText(/Find your API key/)).toBeInTheDocument();
      });
    });

    it("shows language selector with Python as default", async () => {
      const user = userEvent.setup();
      render(<RunFromCICDButton />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /ci\/cd/i });
      await user.click(button);

      await waitFor(() => {
        // Python should be the default selected language
        expect(screen.getByText("Python")).toBeInTheDocument();
      });
    });

    it("shows Python code snippet by default", async () => {
      const user = userEvent.setup();
      render(<RunFromCICDButton />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /ci\/cd/i });
      await user.click(button);

      await waitFor(() => {
        // Should show Python-specific content - look for the keyword token
        const codeTokens = document.querySelectorAll(".token.keyword");
        const hasImport = Array.from(codeTokens).some(
          (el) => el.textContent === "import",
        );
        expect(hasImport).toBe(true);
      });
    });
  });

  describe("Language switching", () => {
    it("switches to TypeScript when selected", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      render(<RunFromCICDButton />, { wrapper: Wrapper });

      // Open dialog
      const button = screen.getByRole("button", { name: /ci\/cd/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Python")).toBeInTheDocument();
      });

      // Open language menu
      const languageButton = screen.getByText("Python");
      await user.click(languageButton);

      // Select TypeScript
      await waitFor(() => {
        expect(screen.getByText("TypeScript")).toBeInTheDocument();
      });
      await user.click(screen.getByText("TypeScript"));

      // Should show TypeScript-specific content - look for "LangWatch" in the code
      await waitFor(() => {
        const code = document.querySelector("pre")?.textContent ?? "";
        expect(code).toContain("LangWatch");
      });
    });

    it("switches to curl when selected", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      render(<RunFromCICDButton />, { wrapper: Wrapper });

      // Open dialog
      const button = screen.getByRole("button", { name: /ci\/cd/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Python")).toBeInTheDocument();
      });

      // Open language menu
      const languageButton = screen.getByText("Python");
      await user.click(languageButton);

      // Select curl
      await waitFor(() => {
        expect(screen.getByText("curl")).toBeInTheDocument();
      });
      await user.click(screen.getByText("curl"));

      // Should show curl-specific content - look for curl in the code
      await waitFor(() => {
        const code = document.querySelector("pre")?.textContent ?? "";
        expect(code).toContain("curl");
      });
    });
  });

  describe("Code snippet content", () => {
    it("includes the evaluation slug in the code snippet", async () => {
      const user = userEvent.setup();
      useEvaluationsV3Store.setState({ experimentSlug: "my-custom-eval" });
      render(<RunFromCICDButton />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /ci\/cd/i });
      await user.click(button);

      await waitFor(() => {
        // The slug should appear in the code
        const code = document.querySelector("pre")?.textContent ?? "";
        expect(code).toContain("my-custom-eval");
      });
    });

    it("uses evaluate() and print_summary() for Python snippet", async () => {
      const user = userEvent.setup();
      render(<RunFromCICDButton />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /ci\/cd/i });
      await user.click(button);

      await waitFor(() => {
        const code = document.querySelector("pre")?.textContent ?? "";
        expect(code).toContain("evaluation.evaluate(");
        expect(code).toContain("print_summary()");
      });
    });
  });
});
