/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RetentionAndUsageCard } from "../RetentionAndUsageCard";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const effective = { traces: 49, scenarios: 49, experiments: 49 };

describe("RetentionAndUsageCard", () => {
  afterEach(cleanup);

  describe("when storage aggregates several projects in a scope", () => {
    it("uses the scope-aware description and shows the project count", () => {
      render(
        <Wrapper>
          <RetentionAndUsageCard
            effective={effective}
            isLoading={false}
            data={{ totalBytes: 20_000_000_000, projectCount: 2 }}
            storageDescription="How much space this organization's data uses today."
          />
        </Wrapper>,
      );
      expect(
        screen.getByText(
          "How much space this organization's data uses today.",
        ),
      ).toBeTruthy();
      expect(screen.getByText(/2 projects/)).toBeTruthy();
    });
  });

  describe("when storage is a single project", () => {
    it("omits the project-count suffix", () => {
      render(
        <Wrapper>
          <RetentionAndUsageCard
            effective={effective}
            isLoading={false}
            data={{ totalBytes: 0, projectCount: 1 }}
          />
        </Wrapper>,
      );
      expect(screen.queryByText(/projects/)).toBeNull();
      // default project-scoped copy
      expect(
        screen.getByText("How much space this project's data uses today."),
      ).toBeTruthy();
    });
  });
});
