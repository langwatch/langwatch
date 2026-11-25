// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";

afterEach(cleanup);

import { Badge } from "@chakra-ui/react";
import { Globe } from "lucide-react";

import { ResourceRow } from "../resource-row.tsx";

describe("ResourceRow", () => {
  /** @scenario "Resource rows show identity and provenance together" */
  it("renders identity, status, explanation and provenance", () => {
    const { container, rerender } = renderWithDesignSystem(
      <ResourceRow
        name="acme.example"
        icon={<Globe />}
        status={<Badge>Verified</Badge>}
        description="Published record"
        meta="Verified by Olive · olive@acme.example"
      />,
    );
    expect(screen.getByText("acme.example")).toBeVisible();
    expect(screen.getByText("Verified")).toBeVisible();
    expect(screen.getByText("Published record")).toBeVisible();
    expect(screen.getByText("Verified by Olive · olive@acme.example")).toBeVisible();
    expect(container.querySelector('[aria-hidden="true"] svg')).toBeInTheDocument();
    rerender(<ResourceRow name="pending.example" status={<Badge>Awaiting verification</Badge>} />);
    expect(screen.getByText("Awaiting verification")).toBeVisible();
    expect(screen.queryByText("Published record")).not.toBeInTheDocument();
    expect(screen.queryByText(/Olive/)).not.toBeInTheDocument();
  });
});
