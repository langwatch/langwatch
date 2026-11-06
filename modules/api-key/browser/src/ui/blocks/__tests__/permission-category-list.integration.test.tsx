/**
 * @vitest-environment jsdom
 * Pins which permission rows open for the ceiling the server answers: a row the ceiling
 * covers can be picked, one it does not stays locked.
 */

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithApiKeyHost } from "../../../testing.tsx";
import { PermissionCategoryList } from "../permission-category-list.tsx";

afterEach(() => cleanup());

function rowTrigger(label: string): HTMLElement | null {
  const row = screen.getByText(label).closest("div")?.parentElement ?? null;
  return row?.querySelector<HTMLElement>("[aria-haspopup]") ?? null;
}

describe("given a ceiling of read on traces and annotations, as a group grant yields", () => {
  describe("when the list renders", () => {
    it("opens the Traces and Annotations rows at Read and keeps the rest locked", async () => {
      const onChange = vi.fn();
      renderWithApiKeyHost(
        <PermissionCategoryList
          selections={{}}
          userPermissions={["traces:view", "annotations:view"]}
          onChange={onChange}
        />,
      );

      expect(rowTrigger("Traces")).not.toBeNull();
      expect(rowTrigger("Annotations")).not.toBeNull();
      expect(rowTrigger("Datasets")).toBeNull();

      const user = userEvent.setup();
      await user.click(rowTrigger("Traces")!);
      expect(await screen.findByRole("menuitem", { name: "Read" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Write" })).toBeNull();
      await user.click(screen.getByRole("menuitem", { name: "Read" }));
      expect(onChange).toHaveBeenCalledWith({ traces: "read" });
    });
  });
});
