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
  it("renders label and formatted usage with max", () => {
    render(<ResourceLimitRow label="Members" current={5} max={10} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByText("/ 10")).toBeInTheDocument();
  });

  it("renders count only when max is omitted", () => {
    const { container } = render(<ResourceLimitRow label="Events" current={42} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(container.textContent).not.toContain("/");
  });

  it("displays 'Unlimited' for large max values (>= 1M)", () => {
    render(<ResourceLimitRow label="Projects" current={3} max={1_000_000} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("/ Unlimited")).toBeInTheDocument();
  });

  it("formats numbers with locale separators", () => {
    render(<ResourceLimitRow label="Messages" current={1000} max={5000} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("/ 5,000")).toBeInTheDocument();
  });
});
