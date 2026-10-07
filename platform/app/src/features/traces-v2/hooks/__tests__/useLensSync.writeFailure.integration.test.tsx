/**
 * @vitest-environment jsdom
 *
 * The lens store writes locally first and mirrors each change to the server.
 * When the server refuses one (a permission, a read only project, a network
 * blip), ana must hear about it, and the strip must reload from the server so
 * a lens it never kept does not linger until the next refetch.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExplorerStore } from "../../stores/explorerStore";
import type { LensConfig } from "../../stores/viewSlice";
import { useLensSync } from "../useLensSync";

type MutationOptions = {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

const { mutations, mutationFor, invalidate, showErrorToast } = vi.hoisted(
  () => {
    const mutations = {} as Record<
      "create" | "rename" | "delete",
      MutationOptions
    >;
    /** A mutation stub that records its options, so a test can fire onError. */
    const mutationFor = (name: "create" | "rename" | "delete") => ({
      useMutation: (options: MutationOptions) => {
        mutations[name] = options;
        return { mutate: vi.fn() };
      },
    });
    return {
      mutations,
      mutationFor,
      invalidate: vi.fn(),
      showErrorToast: vi.fn(),
    };
  },
);

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", kind: "application" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/features/errors", () => ({ showErrorToast }));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({ savedViews: { getAll: { invalidate } } }),
    savedViews: {
      getAll: { useQuery: () => ({ data: undefined }) },
      create: mutationFor("create"),
      rename: mutationFor("rename"),
      delete: mutationFor("delete"),
    },
  },
}));

const USER_LENS: LensConfig = {
  id: "custom-lens-1",
  name: "Slow answers",
  isBuiltIn: false,
  columns: ["time"],
  addons: [],
  grouping: "flat",
  sort: { columnId: "time", direction: "desc" },
  filterText: "",
};

const refusal = new Error("refused");

beforeEach(() => {
  invalidate.mockReset();
  showErrorToast.mockReset();
  useExplorerStore.getState().setUserLenses([USER_LENS]);
});

afterEach(() => {
  cleanup();
});

describe("useLensSync", () => {
  describe.each([
    ["saving", "create", "Couldn't save the lens"],
    ["renaming", "rename", "Couldn't rename the lens"],
    ["deleting", "delete", "Couldn't delete the lens"],
  ] as const)("when the server refuses %s a lens", (_label, name, title) => {
    /** @scenario "A lens the server refuses to save says so and leaves no phantom" */
    it("shows the error and reloads the lens strip from the server", () => {
      renderHook(() => useLensSync());

      act(() => mutations[name]?.onError?.(refusal));

      expect(showErrorToast).toHaveBeenCalledWith({
        error: refusal,
        fallbackTitle: title,
      });
      expect(invalidate).toHaveBeenCalledWith({
        projectId: "proj-1",
        kind: "v2-traces-lens",
      });
    });
  });
});
