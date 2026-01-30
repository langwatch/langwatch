/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ResourceLimitRow } from "../ResourceLimitRow";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("ResourceLimitRow", () => {
  it("renders label and formatted usage", () => {
    render(<ResourceLimitRow label="Members" current={5} max={10} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Members:")).toBeInTheDocument();
    expect(screen.getByText("5 / 10")).toBeInTheDocument();
  });

  it("displays formatted large max values", () => {
    render(<ResourceLimitRow label="Projects" current={3} max={1_000_000} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Projects:")).toBeInTheDocument();
    expect(screen.getByText("3 / 1,000,000")).toBeInTheDocument();
  });

  it("formats numbers with locale separators", () => {
    render(<ResourceLimitRow label="Messages" current={1000} max={5000} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Messages:")).toBeInTheDocument();
    expect(screen.getByText("1,000 / 5,000")).toBeInTheDocument();
  });
});
