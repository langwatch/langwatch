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
  idle: () => ({
    mutate: () => {
      throw new Error("an unexpected licence command was sent");
    },
    isPending: false,
  }),
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: vi.fn() } }),
    licenseRegistry: {
      getChain: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => ({
          data: opts?.enabled && byId.current ? { licenses: [byId.current] } : undefined,
          error: null,
          isLoading: false,
        }),
      },
      updateTerms: { useMutation: idle },
      changeSeats: { useMutation: idle },
      resetInstanceBinding: { useMutation: idle },
      linkToOrganization: { useMutation: idle },
      revoke: {
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: async () => ({}), isPending: false }),
      },
      registerLegacy: { useMutation: idle },
      issue: { useMutation: () => ({ mutate: issue, isPending: false }) },
      reissue: { useMutation: () => ({ mutate: reissue, mutateAsync: reissue, isPending: false }) },
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
    supersededAt: null,
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
  reissue.mockReset();
  reissue.mockResolvedValue({ licenseKey: "signed-dev-seats" });
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

  function openSeats() {
    fireEvent.click(screen.getByRole("button", { name: "Change seats" }));
    return screen.getByRole("spinbutton", { name: "Developer seats" });
  }

  /** @scenario The admin console states and shows Developer seats */
  it("reads the Developer seats, and 0 when the licence states none", () => {
    renderDrawer(license());
    expect(screen.getByText("50 full · 5 lite · 4 Developer")).toBeTruthy();
  });

  it("reads 0 Developer seats for a licence that states none", () => {
    renderDrawer(license({ maxMembersDeveloper: null }));
    expect(screen.getByText("50 full · 5 lite · 0 Developer")).toBeTruthy();
  });

  /** @scenario The admin console states and shows Developer seats */
  it("starts the change at the current Developer seats and reissues the typed count", async () => {
    renderDrawer(license());
    const developers = openSeats();
    expect(developers).toHaveValue(4);

    fireEvent.change(developers, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Change to 7 Developer seats" }));

    await waitFor(() => expect(reissue).toHaveBeenCalledTimes(1));
    expect(reissue.mock.calls[0]?.[0]).toMatchObject({
      id: "il_1",
      maxMembersDeveloper: 7,
      expiresAt: "2027-09-19T12:00:00.000Z",
    });
  });

  it("will not change seats while the Developer seats field is empty", () => {
    renderDrawer(license());
    fireEvent.change(openSeats(), { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Save seats" })).toBeDisabled();
  });

  it("changes full seats and Developer seats one at a time", () => {
    renderDrawer(license());
    fireEvent.change(openSeats(), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Full seats"), { target: { value: "60" } });

    expect(screen.getByRole("button", { name: "Save seats" })).toBeDisabled();
    expect(screen.getByTestId("change-seats-form").textContent).toContain(
      "Change full seats and Developer seats one at a time.",
    );
  });

  /** @scenario The admin console states and shows Developer seats */
  it("reads a typed 00 Developer seats as the 0 the licence states, so full seats can change", () => {
    renderDrawer(license({ maxMembersDeveloper: null }));
    fireEvent.change(openSeats(), { target: { value: "00" } });
    fireEvent.change(screen.getByLabelText("Full seats"), { target: { value: "60" } });

    expect(screen.getByRole("button", { name: "Change to 60 seats" })).toBeEnabled();
  });

  /** @scenario The admin console states and shows Developer seats */
  it.each(["-1", "1.5", "2147483648"])(
    "will not change to %s Developer seats, and says why",
    (typed) => {
      renderDrawer(license());
      fireEvent.change(openSeats(), { target: { value: typed } });

      expect(screen.getByRole("button", { name: "Save seats" })).toBeDisabled();
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
