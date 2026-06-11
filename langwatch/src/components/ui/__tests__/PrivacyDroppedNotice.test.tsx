/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PrivacyDroppedNotice } from "../PrivacyDroppedNotice";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("PrivacyDroppedNotice", () => {
  afterEach(cleanup);

  describe("when nothing was dropped", () => {
    it("renders nothing for an empty category list", () => {
      const { container } = render(
        <Wrapper>
          <PrivacyDroppedNotice categories={[]} />
        </Wrapper>,
      );
      expect(container.textContent).toBe("");
    });

    it("renders nothing when categories is undefined", () => {
      const { container } = render(
        <Wrapper>
          <PrivacyDroppedNotice />
        </Wrapper>,
      );
      expect(container.textContent).toBe("");
    });
  });

  describe("when a single category was dropped", () => {
    it("names the category and explains it was never stored", () => {
      const { container } = render(
        <Wrapper>
          <PrivacyDroppedNotice categories={["input"]} />
        </Wrapper>,
      );
      expect(container.textContent).toContain("The input was dropped");
      expect(container.textContent).toContain("cannot be recovered");
    });
  });

  describe("when several categories were dropped", () => {
    it("lists them with friendly labels and plural grammar", () => {
      const { container } = render(
        <Wrapper>
          <PrivacyDroppedNotice categories={["input", "output", "tools"]} />
        </Wrapper>,
      );
      expect(container.textContent).toContain(
        "input, output, and tool calls were dropped",
      );
      expect(container.textContent).toContain("they are not shown here");
    });
  });
});
