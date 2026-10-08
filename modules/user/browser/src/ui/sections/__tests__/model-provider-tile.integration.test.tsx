/**
 * @vitest-environment jsdom
 *
 * The model-provider tile issues a personal key, and waits while the personal workspace is set up.
 */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { ModelProviderTile } from "../model-provider-tile.tsx";

const { state, invalidations, pendingWorkspace } = vi.hoisted(() => {
  /** The wire shape of the retryable refusal sent before the personal project exists. */
  const pendingWorkspace = (): Error =>
    Object.assign(new Error("personal_workspace_pending"), {
      code: "personal_workspace_pending",
      httpStatus: 409,
      retryable: true,
    });
  const state: { failWith: Error | undefined; contextError: Error | null } = {
    failWith: undefined,
    contextError: null,
  };
  const invalidations: string[] = [];
  return { state, invalidations, pendingWorkspace };
});

vi.mock("../../../behavior/personal-workspace-api.ts", () => {
  const api = {
    useUtils: () => ({
      routingPolicy: {
        personalContext: {
          // The read answers as the server would while the workspace is still being created.
          invalidate: () => {
            invalidations.push("personalContext");
            state.contextError = pendingWorkspace();
          },
        },
      },
    }),
    routingPolicy: {
      personalContext: {
        useQuery: () => ({ data: undefined, error: state.contextError, isFetching: false }),
      },
    },
    personalVirtualKeys: {
      issuePersonal: {
        useMutation: (options: {
          onSuccess?: (data: { label: string; secret: string; baseUrl: string }) => void;
          onError?: (error: Error) => void;
        }) => ({
          isPending: false,
          mutate: () => {
            if (state.failWith) return options.onError?.(state.failWith);
            options.onSuccess?.({ label: "my-app", secret: "sk-lw-secret", baseUrl: "https://gw" });
          },
        }),
      },
    },
  };
  return { api, personalWorkspaceApi: api };
});

beforeEach(() => {
  state.failWith = undefined;
  state.contextError = null;
  invalidations.length = 0;
});

afterEach(() => {
  cleanup();
});

async function issueKey() {
  renderWithPersonalWorkspaceHost(
    <ModelProviderTile
      displayName="Anthropic"
      config={{ providerKey: "anthropic", defaultLabel: "my-app" }}
      organizationId="org_1"
    />,
    { host: fakePersonalWorkspaceHost() },
  );
  await userEvent.click(screen.getByText("Anthropic"));
  await userEvent.click(screen.getByRole("button", { name: "Issue key" }));
}

describe("<ModelProviderTile />", () => {
  describe("when the personal workspace is still being created", () => {
    /** @scenario "Issuing a provider key from its tile waits while the personal workspace is set up" */
    it("waits for the personal workspace instead of showing the raw error", async () => {
      state.failWith = pendingWorkspace();
      await issueKey();

      expect(screen.queryByText("personal_workspace_pending")).not.toBeInTheDocument();
      expect(await screen.findByRole("status")).toHaveTextContent("Setting up your workspace");
      expect(screen.getByRole("button", { name: "Issue key" })).toBeDisabled();
      expect(invalidations).toEqual(["personalContext"]);
    });
  });

  describe("when the server refuses for another reason", () => {
    it("shows the error", async () => {
      state.failWith = new Error("label already used");
      await issueKey();

      expect(screen.getByText("label already used")).toBeInTheDocument();
      expect(invalidations).toEqual([]);
    });
  });
});
