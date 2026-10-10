// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";

afterEach(cleanup);

import { DetailDrawerHeader } from "../detail-drawer-header.tsx";
import { Drawer } from "../drawer.tsx";

describe("DetailDrawerHeader", () => {
  /** @scenario "A detail drawer names its entity and context" */
  it("names the dialog after the entity and shows its kind and context", async () => {
    renderWithDesignSystem(
      <Drawer.Root open>
        <Drawer.Content>
          <Drawer.Header>
            <DetailDrawerHeader kind="SSO connection" title="Acme Workforce">
              <span>Acme · OIDC · Active</span>
            </DetailDrawerHeader>
          </Drawer.Header>
          <Drawer.CloseTrigger />
        </Drawer.Content>
      </Drawer.Root>,
    );
    expect(await screen.findByRole("dialog", { name: "Acme Workforce" })).toBeVisible();
    expect(screen.getByText("SSO connection")).toBeVisible();
    expect(screen.getByText("Acme · OIDC · Active")).toBeVisible();
    expect(screen.getByRole("button", { name: /close/i })).toBeVisible();
  });
});
