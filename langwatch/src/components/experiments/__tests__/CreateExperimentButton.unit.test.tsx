/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockHasPermission, permissionResult } = vi.hoisted(() => ({
  mockHasPermission: vi.fn(),
  permissionResult: { current: true },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "test-project" },
    hasPermission: (permission: string) => mockHasPermission(permission),
  }),
}));

vi.mock("~/hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({ checkAndProceed: vi.fn() }),
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
        useMutation: () => ({ mutate: vi.fn() }),
      },
    },
  },
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

describe("CreateExperimentButton permissions", () => {
  beforeEach(() => {
    permissionResult.current = true;
    mockHasPermission.mockReset();
    mockHasPermission.mockImplementation(() => permissionResult.current);
  });

  afterEach(() => cleanup());

  it("renders when workflows:create is granted", () => {
    render(<CreateExperimentButton />);

    expect(mockHasPermission).toHaveBeenCalledWith("workflows:create");
    expect(screen.getByRole("button", { name: "New Experiment" })).toBeTruthy();
  });

  it("stays hidden when workflows:create is denied", () => {
    permissionResult.current = false;
    render(<CreateExperimentButton />);

    expect(mockHasPermission).toHaveBeenCalledWith("workflows:create");
    expect(screen.queryByRole("button", { name: "New Experiment" })).toBeNull();
  });
});
