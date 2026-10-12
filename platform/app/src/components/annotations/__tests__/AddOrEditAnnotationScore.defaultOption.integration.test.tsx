/**
 * @vitest-environment jsdom
 *
 * Spec: specs/annotations/score-metric-default-option.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("~/features/errors", () => ({
  applyHandledErrorToForm: () => false,
  FormServerError: () => null,
  showErrorToast: vi.fn(),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      annotationScore: {
        getAllActive: { invalidate: vi.fn() },
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
    annotationScore: {
      upsert: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      getById: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

const { AddOrEditAnnotationScore } = await import(
  "../AddOrEditAnnotationScore"
);

afterEach(cleanup);

describe("given a score metric with multiple-choice options", () => {
  /** @scenario "Clicking an option marks it as the default" */
  it("selects a clicked option and names it as the default", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <ChakraProvider value={defaultSystem}>
        <AddOrEditAnnotationScore onClose={vi.fn()} />
      </ChakraProvider>,
    );

    await user.selectOptions(screen.getByRole("combobox"), "OPTION");
    await user.type(screen.getByPlaceholderText("value"), "Approved");
    await user.click(screen.getByRole("radio"));

    expect(screen.getByRole("radio")).toBeChecked();
    expect(screen.getByText("Default Option:")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });
});
