/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockHasPermission,
  mockMutate,
  mockToasterCreate,
  mutationOptions,
  permissionResult,
} = vi.hoisted(() => ({
  mockHasPermission: vi.fn(),
  mockMutate: vi.fn(),
  mockToasterCreate: vi.fn(),
  mutationOptions: {
    current: undefined as undefined | { onError?: (error: unknown) => void },
  },
  permissionResult: { current: true },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "test-project" },
    hasPermission: (permission: string) => mockHasPermission(permission),
  }),
}));

vi.mock("~/hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    checkAndProceed: (action: () => void) => action(),
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      experiments: { getAllForEvaluationsList: { invalidate: vi.fn() } },
    }),
    experiments: {
      saveEvaluationsV3: {
        useMutation: (options: { onError?: (error: unknown) => void }) => {
          mutationOptions.current = options;
          return { mutate: mockMutate };
        },
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mockToasterCreate },
}));

vi.mock("~/components/ui/layouts/PageLayout", () => ({
  PageLayout: {
    HeaderButton: ({
      children,
      disabled,
      onClick,
    }: {
      children?: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
  },
}));

import { CreateExperimentButton } from "../CreateExperimentButton";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderButton = () =>
  render(<CreateExperimentButton />, { wrapper: Wrapper });

describe("given experiment creation permissions and mutation boundaries", () => {
  beforeEach(() => {
    permissionResult.current = true;
    mockHasPermission.mockReset();
    mockHasPermission.mockImplementation(() => permissionResult.current);
    mockMutate.mockReset();
    mockToasterCreate.mockReset();
    mutationOptions.current = undefined;
  });

  afterEach(() => cleanup());

  describe("when workflows:create is granted", () => {
    it("renders the create button", () => {
      renderButton();

      expect(mockHasPermission).toHaveBeenCalledWith("workflows:create");
      expect(
        screen.getByRole("button", { name: "New Experiment" }),
      ).toBeTruthy();
    });
  });

  describe("when workflows:create is denied", () => {
    it("keeps the create button hidden", () => {
      permissionResult.current = false;
      renderButton();

      expect(mockHasPermission).toHaveBeenCalledWith("workflows:create");
      expect(
        screen.queryByRole("button", { name: "New Experiment" }),
      ).toBeNull();
    });
  });

  describe("when the user creates an experiment in the UI", () => {
    it("sends only schema-compatible state to the mutation", async () => {
      renderButton();

      fireEvent.click(screen.getByRole("button", { name: "New Experiment" }));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /Create Experiment/ }),
      );

      expect(mockMutate).toHaveBeenCalledOnce();
      expect(mockMutate.mock.calls[0]?.[0]?.state).not.toHaveProperty(
        "pendingSavedChanges",
      );
    });
  });

  describe("when the user opens the new experiment menu", () => {
    it("offers the SDK workflow", async () => {
      renderButton();

      fireEvent.click(screen.getByRole("button", { name: "New Experiment" }));

      expect(
        await screen.findByRole("menuitem", {
          name: /New Experiment via SDK/,
        }),
      ).toHaveAttribute(
        "href",
        "https://langwatch.ai/docs/evaluations/experiments/sdk",
      );
    });
  });

  describe("when the create mutation fails", () => {
    it("shows the mutation error", () => {
      renderButton();

      act(() => {
        mutationOptions.current?.onError?.(
          new Error("Experiment service failed"),
        );
      });

      expect(mockToasterCreate).toHaveBeenCalledWith({
        title: "Error creating experiment",
        description: "Experiment service failed",
        type: "error",
        meta: { closable: true },
      });
    });
  });
});
