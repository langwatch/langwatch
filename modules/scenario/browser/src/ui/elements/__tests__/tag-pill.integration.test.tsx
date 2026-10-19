/**
 * Integration tests for TagPill component.
 * @vitest-environment jsdom
 * @see specs/features/tag-management.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TagPill } from "../tag-pill.tsx";

describe("<TagPill/>", () => {
  afterEach(cleanup);

  describe("given a label", () => {
    it("displays the label text", () => {
      renderWithDesignSystem(<TagPill label="critical" />);

      expect(screen.getByText("critical")).toBeInTheDocument();
    });
  });

  describe("when onRemove is provided", () => {
    it("displays a remove button", () => {
      renderWithDesignSystem(<TagPill label="billing" onRemove={vi.fn()} />);

      expect(screen.getByRole("button", { name: "Remove billing tag" })).toBeInTheDocument();
    });

    it("calls onRemove when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();

      renderWithDesignSystem(<TagPill label="billing" onRemove={onRemove} />);

      await user.click(screen.getByRole("button", { name: "Remove billing tag" }));
      expect(onRemove).toHaveBeenCalledOnce();
    });
  });

  describe("when onRemove is not provided", () => {
    it("does not display a remove button", () => {
      renderWithDesignSystem(<TagPill label="readonly" />);

      expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    });
  });
});
