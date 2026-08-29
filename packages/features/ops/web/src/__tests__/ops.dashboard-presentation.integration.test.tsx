/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HealthLine, LinkedStat } from "../index";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("HealthLine", () => {
  it("shows all-clear only after the anomaly query is known to have succeeded", () => {
    const { rerender } = render(
      <HealthLine errorClusterCount={0} anomalyCount={0} anomaliesKnown={false} />,
      { wrapper },
    );

    expect(screen.queryByTestId("ops-health-line")).toBeNull();

    rerender(<HealthLine errorClusterCount={0} anomalyCount={0} anomaliesKnown />);
    expect(screen.getByTestId("ops-health-line")).not.toBeNull();
  });

  it("hides all-clear while either problem count is non-zero", () => {
    const { rerender } = render(
      <HealthLine errorClusterCount={1} anomalyCount={0} anomaliesKnown />,
      { wrapper },
    );

    expect(screen.queryByTestId("ops-health-line")).toBeNull();
    rerender(<HealthLine errorClusterCount={0} anomalyCount={1} anomaliesKnown />);
    expect(screen.queryByTestId("ops-health-line")).toBeNull();
  });
});

describe("LinkedStat", () => {
  it("keeps metric fields and warning state while using the controlled link port", () => {
    render(
      <LinkedStat
        label="Failed"
        value="2.50/s"
        sublabel="25 total"
        href="/ops/queues"
        warning
        testId="failed-stat"
        link={(content, href) => <a href={href}>{content}</a>}
      />,
      { wrapper },
    );

    const stat = screen.getByTestId("failed-stat");
    expect(stat.getAttribute("data-warning")).toBe("true");
    expect(screen.getByText("Failed")).not.toBeNull();
    expect(screen.getByText("2.50/s")).not.toBeNull();
    expect(screen.getByText("25 total")).not.toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/ops/queues");
  });
});
