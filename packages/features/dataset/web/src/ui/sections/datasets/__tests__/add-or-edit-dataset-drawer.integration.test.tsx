/**
 * @vitest-environment jsdom
 * A bare-address open (no caller, `onSuccess` unset) must submit and close
 * (dev/docs/best_practices/drawers.md), not throw.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const closeDrawer = vi.fn();
const created = vi.fn();

vi.mock("@langwatch/ui-host/use-drawer", () => ({
  useDrawer: () => ({ closeDrawer }),
}));

vi.mock("@langwatch/workflow-web/studio-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_1", slug: "acme" } }),
}));

const toasts: Array<{ title?: string }> = [];
vi.mock("@langwatch/workflow-web/studio-host/toaster", () => ({
  toaster: { create: (toast: { title?: string }) => toasts.push(toast) },
}));

vi.mock("@langwatch/workflow-web/studio-host/errors", () => ({
  describeError: () => "",
  readHandledError: () => void 0,
  showErrorToast: () => void 0,
}));

vi.mock("@langwatch/workflow-web", () => ({
  tryToMapPreviousColumnsToNewColumns: (records: unknown) => records,
}));

/**
 * The mutation, answering the way tRPC does: `mutate` runs the caller's own
 * `onSuccess` with the written row. That callback is where the crash lived, so
 * a double that never calls it would prove nothing.
 */
vi.mock("@langwatch/workflow-web/studio-host/api", () => ({
  api: {
    dataset: {
      upsert: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            input: { name: string; columnTypes: unknown },
            handlers: { onSuccess: (row: unknown) => void },
          ) => {
            created(input);
            handlers.onSuccess({
              id: "dataset_1",
              name: input.name,
              columnTypes: input.columnTypes,
            });
          },
        }),
      },
      getById: { useQuery: () => ({ data: void 0 }) },
      validateDatasetName: { useQuery: () => ({ refetch: () => Promise.resolve({}) }) },
    },
    useUtils: () => ({ dataset: { getAll: { invalidate: () => void 0 } } }),
  },
}));

import { AddOrEditDatasetDrawer } from "../add-or-edit-dataset-drawer";

const mount = (element: ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{element}</ChakraProvider>);

describe("given the dataset editor opened from a bare drawer address", () => {
  describe("when the reader names a dataset and creates it", () => {
    /** @scenario "A bare-URL open of the dataset editor creates the dataset and closes" */
    /** @scenario "A sub-flow target with no caller closes the drawer itself" */
    it("writes the dataset and closes, with no caller to tell", async () => {
      mount(<AddOrEditDatasetDrawer open />);

      // `fireEvent.change` rather than a typed run: the name field re-renders
      // on every keystroke behind the slug check, and what this case is about
      // is the submit, not the typing.
      fireEvent.change(await screen.findByRole("textbox", { name: /name/i }), {
        target: { value: "Golden set" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Dataset" }));

      await waitFor(() => expect(created).toHaveBeenCalled());
      expect(created.mock.calls[0]?.[0]).toMatchObject({ name: "Golden set" });
      expect(closeDrawer).toHaveBeenCalled();
    });
  });
});
