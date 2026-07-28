/**
 * @vitest-environment jsdom
 *
 * @see specs/evaluations/experiments-online-evaluations-separation.feature
 */
import { ChakraProvider, defaultSystem, Text } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FullWidthListPageContent } from "../FullWidthListPageContent";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<FullWidthListPageContent />", () => {
  afterEach(cleanup);

  /** @scenario Use the available width for online evaluation configuration */
  it("uses the full available content width", () => {
    render(
      <FullWidthListPageContent>
        <Text>Configuration table</Text>
      </FullWidthListPageContent>,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("full-width-list-page-content")).toHaveStyle({
      width: "var(--chakra-sizes-full)",
    });
  });
});
