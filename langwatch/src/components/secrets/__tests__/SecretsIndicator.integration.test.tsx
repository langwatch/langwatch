/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { SecretsIndicator } from "../SecretsIndicator";

let mockSecrets: Array<{ id: string; name: string }> = [];
let mockIsLoading = false;

vi.mock("~/utils/api", () => ({
  api: {
    secrets: {
      list: {
        useQuery: vi.fn(() => ({
          data: mockSecrets,
          isLoading: mockIsLoading,
        })),
      },
    },
  },
}));

afterEach(cleanup);

const mockOnInsertSecret = vi.fn();

function renderIndicator({
  onInsertSecret,
}: { onInsertSecret?: (name: string) => void } = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SecretsIndicator
        projectId="test-project-id"
        onInsertSecret={onInsertSecret}
      />
    </ChakraProvider>,
  );
}

describe("<SecretsIndicator />", () => {
  beforeEach(() => {
    mockSecrets = [];
    mockIsLoading = false;
    mockOnInsertSecret.mockClear();
  });

  it("renders the trigger button with key icon", () => {
    renderIndicator();
    expect(screen.getByTestId("secrets-indicator")).toBeInTheDocument();
    expect(screen.getByText("Secrets")).toBeInTheDocument();
  });

  describe("when clicked", () => {
    it("shows usage hint at the bottom of the popover", async () => {
      const user = userEvent.setup();
      renderIndicator();

      await user.click(screen.getByTestId("secrets-indicator"));

      await waitFor(() => {
        expect(screen.getByText(/syntax in your code/)).toBeInTheDocument();
      });
    });

    describe("when secrets exist", () => {
      beforeEach(() => {
        mockSecrets = [
          { id: "s1", name: "OPENAI_API_KEY" },
          { id: "s2", name: "DATABASE_URL" },
        ];
      });

      it("shows available secrets", async () => {
        const user = userEvent.setup();
        renderIndicator();

        await user.click(screen.getByTestId("secrets-indicator"));

        await waitFor(() => {
          expect(screen.getByText("OPENAI_API_KEY")).toBeInTheDocument();
          expect(screen.getByText("DATABASE_URL")).toBeInTheDocument();
        });
      });

      it("calls onInsertSecret when a secret row is clicked", async () => {
        const user = userEvent.setup();
        renderIndicator({ onInsertSecret: mockOnInsertSecret });

        await user.click(screen.getByTestId("secrets-indicator"));
        await waitFor(() => {
          expect(screen.getByText("OPENAI_API_KEY")).toBeInTheDocument();
        });

        await user.click(screen.getByTestId("secret-item-OPENAI_API_KEY"));

        expect(mockOnInsertSecret).toHaveBeenCalledWith("OPENAI_API_KEY");
      });

      it("renders manage secrets link with target blank", async () => {
        const user = userEvent.setup();
        renderIndicator();

        await user.click(screen.getByTestId("secrets-indicator"));

        await waitFor(() => {
          const link = screen.getByRole("link", {
            name: /Manage secrets/,
          });
          expect(link).toHaveAttribute("href", "/settings/secrets");
          expect(link).toHaveAttribute("target", "_blank");
        });
      });
    });

    describe("when no secrets exist", () => {
      it("shows empty state with link to settings", async () => {
        const user = userEvent.setup();
        renderIndicator();

        await user.click(screen.getByTestId("secrets-indicator"));

        await waitFor(() => {
          expect(screen.getByText("No secrets yet.")).toBeInTheDocument();
          const link = screen.getByRole("link", {
            name: /Add secrets in Settings/,
          });
          expect(link).toHaveAttribute("target", "_blank");
        });
      });
    });
  });
});
