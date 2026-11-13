/** @vitest-environment jsdom */
/**
 * Developer seats in the admin console's licence screens: issued, reissued and shown.
 * Spec: enterprise/modules/licensing/specs/licensing.feature
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import type { License } from "../model/license-terms.ts";
import { LicenseDetailDrawer } from "../ui/sections/license-detail-drawer.tsx";
import { LicenseIssueDrawer } from "../ui/sections/license-issue-drawer.tsx";

const { issue, reissue, byId, idle } = vi.hoisted(() => ({
  issue: vi.fn(),
  reissue: vi.fn(),
  byId: { current: undefined as License | undefined },
  idle: () => ({ mutate: () => undefined, isPending: false }),
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: vi.fn() } }),
    licenseRegistry: {
      getById: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => ({
          data: opts?.enabled ? byId.current : undefined,
          error: null,
          isLoading: false,
        }),
      },
      updateTerms: { useMutation: idle },
      changeSeats: { useMutation: idle },
      resetInstanceBinding: { useMutation: idle },
      linkToOrganization: { useMutation: idle },
      revoke: { useMutation: idle },
      registerLegacy: { useMutation: idle },
      issue: { useMutation: () => ({ mutate: issue, isPending: false }) },
      reissue: { useMutation: () => ({ mutate: reissue, isPending: false }) },
    },
  },
}));

function license(overrides: Partial<License> = {}): License {
  return {
    id: "il_1",
    licenseId: "lic-1",
    organizationId: "org_1",
    organizationName: "ACME Rockets",
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 5,
    liteSeatsUnlimited: false,
    maxMembersDeveloper: 4,
    issuedAt: "2026-09-19T12:00:00.000Z",
    expiresAt: "2027-09-19T12:00:00.000Z",
    source: "BACKOFFICE",
    revokedAt: null,
    revokedReason: null,
    replacesId: null,
    services: [],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 0,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: null,
    instanceBoundAt: null,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    status: "active",
    hasPendingDelivery: false,
    ...overrides,
  };
}

beforeEach(() => {
  issue.mockClear();
  reissue.mockClear();
});

describe("LicenseIssueDrawer, Developer seats", () => {
  /** @scenario The admin console states and shows Developer seats */
  it("sends no Developer seats when empty, and the typed number otherwise", async () => {
    renderWithOpsHost(<LicenseIssueDrawer open={true} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText("Organization id on LangWatch Cloud"), {
      target: { value: "org_acme" },
    });
    fireEvent.change(screen.getByLabelText(/Contact email/), {
      target: { value: "ops@acme.test" },
    });
    fireEvent.change(screen.getByLabelText(/Term ends/), { target: { value: "2027-11-13" } });
    const developers = screen.getByRole("spinbutton", { name: "Developer seats" });
    expect(developers).toHaveValue(null);

    fireEvent.click(screen.getByRole("button", { name: "Issue license" }));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
    expect(issue.mock.calls[0]?.[0]).not.toHaveProperty("maxMembersDeveloper");

    fireEvent.change(developers, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue license" }));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(2));
    expect(issue.mock.calls[1]?.[0]).toMatchObject({ maxMembersDeveloper: 6 });
  });
});

describe("LicenseDetailDrawer, Developer seats", () => {
  function renderDrawer(row: License) {
    byId.current = row;
    renderWithOpsHost(
      <LicenseDetailDrawer licenseId={row.id} onClose={vi.fn()} onRevoke={vi.fn()} />,
    );
  }

  /** @scenario The admin console states and shows Developer seats */
  it("reads the Developer seats, and 0 when the licence states none", () => {
    renderDrawer(license());
    expect(screen.getByText("50 full, 5 lite, 4 Developer")).toBeTruthy();
  });

  it("reads 0 Developer seats for a licence that states none", () => {
    renderDrawer(license({ maxMembersDeveloper: null }));
    expect(screen.getByText("50 full, 5 lite, 0 Developer")).toBeTruthy();
  });

  /** @scenario The admin console states and shows Developer seats */
  it("starts the reissue at the current Developer seats and sends the typed count", () => {
    renderDrawer(license());
    const developers = screen.getByRole("spinbutton", { name: "Developer seats" });
    expect(developers).toHaveValue(4);

    fireEvent.change(developers, { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("New term end"), { target: { value: "2028-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Reissue license" }));

    expect(reissue).toHaveBeenCalledTimes(1);
    expect(reissue.mock.calls[0]?.[0]).toMatchObject({ id: "il_1", maxMembersDeveloper: 7 });
  });

  it("will not reissue while the Developer seats field is empty", () => {
    renderDrawer(license());
    fireEvent.change(screen.getByRole("spinbutton", { name: "Developer seats" }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("New term end"), { target: { value: "2028-01-01" } });

    expect(screen.getByRole("button", { name: "Reissue license" })).toBeDisabled();
  });

  /** @scenario The admin console states and shows Developer seats */
  it.each(["-1", "1.5", "2147483648"])(
    "will not reissue %s Developer seats, and says why",
    (typed) => {
      renderDrawer(license());
      fireEvent.change(screen.getByRole("spinbutton", { name: "Developer seats" }), {
        target: { value: typed },
      });
      fireEvent.change(screen.getByLabelText("New term end"), { target: { value: "2028-01-01" } });

      expect(screen.getByRole("button", { name: "Reissue license" })).toBeDisabled();
      expect(screen.getByRole("spinbutton", { name: "Developer seats" })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    },
  );
});

describe("LicenseIssueDrawer, a Developer seat count that cannot be signed", () => {
  it("names the field and issues nothing", async () => {
    renderWithOpsHost(<LicenseIssueDrawer open={true} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText("Organization id on LangWatch Cloud"), {
      target: { value: "org_acme" },
    });
    fireEvent.change(screen.getByLabelText(/Contact email/), {
      target: { value: "ops@acme.test" },
    });
    fireEvent.change(screen.getByLabelText(/Term ends/), { target: { value: "2027-11-13" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Developer seats" }), {
      target: { value: "-2" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Issue license" }));

    expect(
      await screen.findByText("Enter a whole number of Developer seats, 0 or more."),
    ).toBeTruthy();
    expect(issue).not.toHaveBeenCalled();
  });
});
