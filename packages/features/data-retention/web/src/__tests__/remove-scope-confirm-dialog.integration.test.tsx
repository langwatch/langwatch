/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { RetentionScopeGroup } from "../grouping";
import { RemoveScopeConfirmDialog } from "../remove-scope-confirm-dialog";

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
  afterEach(cleanup);

  describe("given a scope group targeted for removal", () => {
    describe("when the fallback retention has resolved", () => {
      it("reassures that no data is deleted", () => {
        render(
          <Wrapper>
            <RemoveScopeConfirmDialog
              group={group}
              isRemoving={false}
              onCancel={() => {}}
              onConfirm={() => {}}
              preview={{
                data: { traces: 49, scenarios: 49, experiments: 49 },
                isLoading: false,
                isError: false,
              }}
            />
          </Wrapper>,
        );
        expect(screen.getByText(/No data is deleted/i)).toBeTruthy();
      });

      it("shows the current value falling back to the resolved value", () => {
        render(
          <Wrapper>
            <RemoveScopeConfirmDialog
              group={group}
              isRemoving={false}
              onCancel={() => {}}
              onConfirm={() => {}}
              preview={{
                data: { traces: 49, scenarios: 49, experiments: 49 },
                isLoading: false,
                isError: false,
              }}
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
        render(
          <Wrapper>
            <RemoveScopeConfirmDialog
              group={group}
              isRemoving={false}
              onCancel={() => {}}
              onConfirm={() => {}}
              preview={{ data: undefined, isLoading: true, isError: false }}
            />
          </Wrapper>,
        );
        expect(screen.getByText(/Resolving fallback/i)).toBeTruthy();
        expect(screen.queryByText("49 days")).toBeNull();
      });
    });

    describe("when the fallback preview failed to load", () => {
      it("warns that the preview couldn't resolve but removal still works", () => {
        render(
          <Wrapper>
            <RemoveScopeConfirmDialog
              group={group}
              isRemoving={false}
              onCancel={() => {}}
              onConfirm={() => {}}
              preview={{ data: undefined, isLoading: false, isError: true }}
            />
          </Wrapper>,
        );
        expect(screen.getByText(/Couldn't preview the fallback retention/i)).toBeTruthy();
      });
    });
  });
});
