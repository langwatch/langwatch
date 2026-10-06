/**
 * @vitest-environment jsdom
 *
 * The provisioning-setup drawer other modules open by token (Q61).
 */

import { ProvisioningSetupDrawerToken } from "@langwatch/enterprise-scim-contract";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeScimHost, renderWithScimHost } from "../../../testing.tsx";
import { ProvisioningSetupDrawer } from "../provisioning-setup-drawer.tsx";

vi.mock("../scim.screen.tsx", () => ({
  ScimSettingsContent: ({ organizationId }: { organizationId: string }) => (
    <p>provisioning for {organizationId}</p>
  ),
}));

afterEach(cleanup);

describe("the provisioning-setup drawer", () => {
  it("is published under scim's own drawer token", () => {
    expect(ProvisioningSetupDrawerToken).toMatchObject({
      kind: "drawer",
      owner: "scim",
      name: "provisioningSetup",
    });
  });

  it("shows the reader's organization's provisioning", async () => {
    renderWithScimHost(<ProvisioningSetupDrawer />, new FakeScimHost({ organizationId: "org-9" }));

    expect(await screen.findByText("provisioning for org-9")).toBeVisible();
  });

  it("closes through the host that opened it", async () => {
    const { host } = renderWithScimHost(<ProvisioningSetupDrawer />);

    fireEvent.click(await screen.findByRole("button", { name: /close/i }));

    expect(host.closedOverlays).toBeGreaterThan(0);
  });
});
