/**
 * @vitest-environment jsdom
 *
 * The email suppressions page renders inside the settings chrome.
 *
 * `SettingsLayout` stands in for the real one here, which lets the test say
 * where the page content sits rather than only that the layout was imported.
 * The layout itself carries the top bar and the settings menu, and its own
 * suites cover what it draws.
 *
 * Spec: specs/settings/settings-page-chrome.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), back: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    project: { id: "proj-1", slug: "test-project" },
    hasPermission: () => true,
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      emailSuppression: { getAll: { invalidate: vi.fn() } },
    }),
    emailSuppression: {
      getAll: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          isRefetching: false,
          refetch: vi.fn(),
        }),
      },
      remove: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

const { default: EmailSuppressionsPage } = await import(
  "~/pages/settings/email-suppressions"
);

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EmailSuppressionsPage />
    </ChakraProvider>,
  );
}

describe("the email suppressions page", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when a reader who can view triggers opens it", () => {
    /** @scenario The email suppressions page carries the settings chrome */
    it("puts its content inside the settings layout", () => {
      renderPage();

      const layout = within(screen.getByTestId("settings-layout"));

      expect(layout.getByText("Email Suppressions")).toBeTruthy();
      expect(layout.getByText("No suppressions yet")).toBeTruthy();
    });
  });
});
