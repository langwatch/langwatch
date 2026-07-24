/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RetentionScopeGroup } from "../grouping";

const queryMock = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    dataRetention: {
      previewScopeRemoval: { useQuery: (...args: any[]) => queryMock(...args) },
    },
  },
}));

import { RemoveScopeConfirmDialog } from "../RemoveScopeConfirmDialog";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const group: RetentionScopeGroup = {
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  name: "Acme",
  byCategory: { traces: 91, scenarios: 91, experiments: 91 },
  rules: [],
};

describe("RemoveScopeConfirmDialog", () => {
  afterEach(() => {
    cleanup();
    queryMock.mockReset();
  });

  describe("given a scope group targeted for removal", () => {
    describe("when the fallback retention has resolved", () => {
      it("reassures that no data is deleted", () => {
        queryMock.mockReturnValue({
          data: { traces: 49, scenarios: 49, experiments: 49 },
          isLoading: false,
          isError: false,
        });
        render(
          <Wrapper>
            <RemoveScopeConfirmDialog
              group={group}
              projectId="proj-1"
              isRemoving={false}
              onCancel={() => {}}
              onConfirm={() => {}}
            />
          </Wrapper>,
        );
        expect(screen.getByText(/No data is deleted/i)).toBeTruthy();
      });

      it("shows the current value falling back to the resolved value", () => {
        queryMock.mockReturnValue({
          data: { traces: 49, scenarios: 49, experiments: 49 },
          isLoading: false,
          isError: false,
        });
        render(
          <Wrapper>
            <RemoveScopeConfirmDialog
              group={group}
              projectId="proj-1"
              isRemoving={false}
              onCancel={() => {}}
              onConfirm={() => {}}
            />
          </Wrapper>,
        );
        // current 91 days → fallback 49 days
        expect(screen.getByText("91 days")).toBeTruthy();
        expect(screen.getByText("49 days")).toBeTruthy();
      });
    });

    describe("when the fallback is still resolving", () => {
      it("shows a resolving indicator instead of a guessed number", () => {
        queryMock.mockReturnValue({
          data: undefined,
          isLoading: true,
          isError: false,
        });
        render(
          <Wrapper>
            <RemoveScopeConfirmDialog
              group={group}
              projectId="proj-1"
              isRemoving={false}
              onCancel={() => {}}
              onConfirm={() => {}}
            />
          </Wrapper>,
        );
        expect(screen.getByText(/Resolving fallback/i)).toBeTruthy();
        expect(screen.queryByText("49 days")).toBeNull();
      });
    });
  });

  describe("given no scope group is targeted", () => {
    describe("when the dialog renders", () => {
      it("does not query for a fallback", () => {
        queryMock.mockReturnValue({
          data: undefined,
          isLoading: false,
          isError: false,
        });
        render(
          <Wrapper>
            <RemoveScopeConfirmDialog
              group={null}
              projectId="proj-1"
              isRemoving={false}
              onCancel={() => {}}
              onConfirm={() => {}}
            />
          </Wrapper>,
        );
        // The query hook is always called (rules of hooks) but disabled.
        const lastCall = queryMock.mock.calls.at(-1);
        expect(lastCall?.[1]).toMatchObject({ enabled: false });
      });
    });
  });
});
