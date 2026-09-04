/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DigestCompactWireframe,
  GraphAlertCompactWireframe,
  TraceAlertCompactWireframe,
} from "../wireframes";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("layout wireframes", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given the trace alert compact wireframe", () => {
    it("shows representative example text instead of empty bars", () => {
      const { container } = render(<TraceAlertCompactWireframe />, {
        wrapper: Wrapper,
      });

      // A wireframe of only flat colour bars carries no text at all — the
      // regression this guards is exactly that: no accessible text content.
      expect(container.textContent).toContain("High error rate");
      expect(container.textContent).toContain(
        "The capital of France is Paris.",
      );
    });
  });

  describe("given the digest compact wireframe", () => {
    it("shows a representative trace row instead of an unlabeled bar", () => {
      const { container } = render(<DigestCompactWireframe />, {
        wrapper: Wrapper,
      });

      expect(container.textContent).toContain("score 0.42");
    });
  });

  describe("given the graph alert compact wireframe", () => {
    it("shows a representative metric line instead of unlabeled bars", () => {
      const { container } = render(<GraphAlertCompactWireframe />, {
        wrapper: Wrapper,
      });

      expect(container.textContent).toContain("p95 latency");
    });
  });
});
