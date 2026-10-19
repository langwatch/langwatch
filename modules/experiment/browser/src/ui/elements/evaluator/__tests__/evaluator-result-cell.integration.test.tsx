/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BatchTargetCell } from "../../../sections/batch-results/batch-target-cell.tsx";

const result = {
  status: "processed",
  passed: false,
  score: 0,
  details: "Invalid JSON",
  extra: "kept",
};
const renderCell = (output: unknown, isEvaluator = true) =>
  renderWithDesignSystem(
    <BatchTargetCell
      isEvaluator={isEvaluator}
      targetOutput={{
        targetId: "evaluator",
        output,
        cost: null,
        duration: null,
        error: null,
        traceId: null,
        evaluatorResults: [],
      }}
    />,
  );

afterEach(cleanup);

describe("evaluator result cells", () => {
  /** @scenario Evaluator verdicts are readable without opening JSON */
  it.each([
    [result, "Failed", "0.00"],
    [{ status: "processed", passed: true, score: 1 }, "Passed", "1.00"],
    [{ status: "processed", score: 0.42 }, "Processed", "0.42"],
    [{ status: "skipped", details: "Missing input" }, "Skipped", null],
    [{ status: "error", details: "Unavailable" }, "Error", null],
  ])("renders %j as %s", (output, status, score) => {
    renderCell(output);
    expect(screen.getByText(status)).toBeVisible();
    expect(screen.queryByText(/^Score /)?.textContent ?? null).toBe(
      score ? `Score ${score}` : null,
    );
  });

  it("highlights a failed verdict and shows its explanation", () => {
    const { container } = renderCell(result);
    expect(screen.getByText(result.details)).toBeVisible();
    expect(container.querySelector('[data-evaluation-status="failed"]')).toHaveStyle({
      background: "var(--chakra-colors-red-subtle)",
      borderLeftColor: "var(--chakra-colors-red-fg)",
    });
  });

  it.each([JSON.stringify(result), { output: result }, { output: JSON.stringify(result) }])(
    "reads persisted evaluator output %j",
    (output) => {
      renderCell(output);
      expect(screen.getByText("Failed")).toBeVisible();
      expect(screen.getByText("Score 0.00")).toBeVisible();
      expect(screen.getByText(result.details)).toBeVisible();
    },
  );

  /** @scenario The full evaluator result remains available */
  it("opens and closes the complete JSON", async () => {
    const { container } = renderCell(result);
    const toggle = screen.getByRole("button", { name: "JSON" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector(`#${CSS.escape(toggle.getAttribute("aria-controls") ?? "")}`),
    ).toHaveTextContent('"extra": "kept"');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/"extra"/)).not.toBeInTheDocument();
  });

  /** @scenario Ordinary target output is not treated as an evaluator verdict */
  it("keeps prompt JSON unchanged", () => {
    renderCell(result, false);
    expect(screen.queryByRole("button", { name: "JSON" })).not.toBeInTheDocument();
    expect(screen.getByText(/"passed": false/)).toHaveTextContent('"extra": "kept"');
  });
});
