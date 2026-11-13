/**
 * The approval page over an in-memory staff access backend and a stubbed browser passkey.
 * Spec: modules/staff-access/specs/staff-access-pages.feature
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  approvalView,
  backend,
  handledError,
  PASSKEY_ASSERTION,
  renderStaffAccess,
} from "../../../testing.tsx";
import { ApproveRequestContent } from "../approve-request.screen.tsx";

const passkey = vi.hoisted(() => ({ startAuthentication: vi.fn() }));

vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: passkey.startAuthentication }));
vi.mock("../../../behavior/staff-access-api.ts", async () => ({
  staffAccessApi: (await import("../../../testing.tsx")).fakeStaffAccessApi,
}));

function renderPage() {
  return renderStaffAccess(<ApproveRequestContent requestId="sar_1" />);
}

beforeEach(() => {
  backend.reset();
  passkey.startAuthentication.mockReset();
  passkey.startAuthentication.mockResolvedValue(PASSKEY_ASSERTION);
});

describe("given a pending request", () => {
  describe("when its reason holds markup", () => {
    beforeEach(() => {
      backend.approval = approvalView({
        scopes: ["org:metadata", "ops:read"],
        reason: "<b>urgent</b> <img src=x onerror=alert(1)> fix the evaluator",
      });
    });

    /** @scenario "The approval page shows the request with the reason as plain text" */
    it("shows everything the signature approves, the reason as text", () => {
      renderPage();

      expect(screen.getByTestId("staff-access-organization-name")).toHaveTextContent("ACME");
      expect(screen.getByText("org_acme")).toBeInTheDocument();
      expect(screen.getByText("Organization metadata")).toBeInTheDocument();
      expect(screen.getByText("Ops read")).toBeInTheDocument();
      expect(screen.getByText(/No trace or dataset content/)).toBeInTheDocument();
      expect(screen.getByText("olivia-mbp")).toBeInTheDocument();
      expect(screen.getByText("203.0.113.7")).toBeInTheDocument();
      expect(screen.getByTestId("staff-access-approval-countdown")).toHaveTextContent(
        /In \d+:\d\d/,
      );

      const reason = screen.getByTestId("staff-access-reason");
      expect(reason.textContent).toBe(
        "<b>urgent</b> <img src=x onerror=alert(1)> fix the evaluator",
      );
      expect(reason.querySelector("b")).toBeNull();
      expect(reason.querySelector("img")).toBeNull();
    });
  });

  describe("when the operator approves a metadata request", () => {
    it("signs the server's options and approves with the assertion", async () => {
      renderPage();
      await userEvent.click(screen.getByTestId("staff-access-approve-button"));

      await screen.findByTestId("staff-access-phase-approved");
      expect(backend.callsTo("approvalOptions")).toEqual([
        { requestId: "sar_1", spendApproved: false },
      ]);
      expect(backend.callsTo("approve")).toEqual([
        { requestId: "sar_1", spendApproved: false, assertion: PASSKEY_ASSERTION },
      ]);
      expect(screen.queryByTestId("staff-access-approve-button")).toBeNull();
    });
  });

  describe("when the operator denies it", () => {
    it("shows it denied", async () => {
      renderPage();
      await userEvent.click(screen.getByTestId("staff-access-deny-button"));

      await screen.findByTestId("staff-access-phase-denied");
      expect(backend.callsTo("deny")).toEqual([{ requestId: "sar_1" }]);
    });
  });
});

describe("given a pending content request", () => {
  beforeEach(() => {
    backend.approval = approvalView({
      scopes: ["org:content"],
      typedNameRequired: { withSpend: true, withoutSpend: true },
    });
  });

  /** @scenario "Content access asks for the organization name before the passkey" */
  it("warns, asks for the organization name, then signs with it", async () => {
    renderPage();
    expect(screen.getByTestId("staff-access-content-warning")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("staff-access-approve-button"));
    expect(await screen.findByText("Type the organization name exactly as shown.")).toBeVisible();
    expect(passkey.startAuthentication).not.toHaveBeenCalled();
    expect(backend.callsTo("approvalOptions")).toEqual([]);

    await userEvent.type(screen.getByTestId("staff-access-typed-name-input"), "ACME Corp");
    await userEvent.click(screen.getByTestId("staff-access-approve-button"));
    expect(passkey.startAuthentication).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByTestId("staff-access-typed-name-input"));
    await userEvent.type(screen.getByTestId("staff-access-typed-name-input"), "ACME");
    await userEvent.click(screen.getByTestId("staff-access-approve-button"));

    await screen.findByTestId("staff-access-phase-approved");
    expect(backend.callsTo("approvalOptions")).toEqual([
      { requestId: "sar_1", spendApproved: false, typedOrganizationName: "ACME" },
    ]);
  });
});

describe("given a pending copy target request", () => {
  beforeEach(() => {
    backend.approval = approvalView({
      scopes: ["copy:target"],
      organizationId: "org_globex",
      organizationName: "Globex",
      counterpartOrganizationId: "org_acme",
      counterpartOrganizationName: "ACME",
      copyGrant: ["project:create", "datasets:create"],
      typedNameRequired: { withSpend: true, withoutSpend: true },
    });
  });

  /** @scenario "The approval page shows the other organization and the target grant" */
  it("shows the copy direction and what the copy may create before signing", () => {
    renderPage();

    expect(screen.getByText("Copy into this organization")).toBeInTheDocument();
    expect(screen.getByTestId("staff-access-copy-direction")).toHaveTextContent(
      "From ACME into Globex",
    );
    const grant = screen.getByTestId("staff-access-copy-grant");
    expect(grant).toHaveTextContent("project:create");
    expect(grant).toHaveTextContent("datasets:create");
  });
});

describe("given a pending support request", () => {
  beforeEach(() => {
    backend.approval = approvalView({
      scopes: ["org:support"],
      spendOffered: true,
      typedNameRequired: { withSpend: true, withoutSpend: false },
    });
  });

  /** @scenario "Spend is off by default and ticking it asks for the organization name" */
  it("starts with spend off and asks for the name only once spend is ticked", async () => {
    renderPage();
    const tick = screen.getByTestId("staff-access-spend-tick");
    expect(tick).not.toBeChecked();
    expect(screen.queryByTestId("staff-access-typed-name-input")).toBeNull();
    expect(screen.queryByTestId("staff-access-content-warning")).toBeNull();

    await userEvent.click(tick);
    expect(tick).toBeChecked();
    await userEvent.type(screen.getByTestId("staff-access-typed-name-input"), "ACME");
    await userEvent.click(screen.getByTestId("staff-access-approve-button"));

    await screen.findByTestId("staff-access-phase-approved");
    expect(backend.callsTo("approve")).toEqual([
      {
        requestId: "sar_1",
        spendApproved: true,
        typedOrganizationName: "ACME",
        assertion: PASSKEY_ASSERTION,
      },
    ]);
  });
});

describe("given the server refuses the passkey assertion", () => {
  beforeEach(() => {
    let refusals = 1;
    backend.handlers.approve = () => {
      if (refusals-- > 0) {
        throw handledError("passkey_assertion_refused", 403, {
          reason: "user_verification_missing",
        });
      }
      return { ...backend.approval, status: "approved" };
    };
  });

  /** @scenario "A refused passkey is shown plainly with a retry" */
  it("says why, keeps the request pending and retries", async () => {
    renderPage();
    await userEvent.click(screen.getByTestId("staff-access-approve-button"));

    const failure = await screen.findByTestId("staff-access-ceremony-failed");
    expect(failure).toHaveTextContent("That passkey didn't confirm it was you");
    expect(screen.getByTestId("staff-access-approve-button")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("staff-access-phase-approved");
    expect(backend.callsTo("approve")).toHaveLength(2);
  });

  describe("when the operator closes the passkey prompt instead", () => {
    beforeEach(() => {
      passkey.startAuthentication.mockRejectedValue(
        Object.assign(new Error("closed"), { name: "NotAllowedError" }),
      );
    });

    it("says the check did not finish and approves nothing", async () => {
      renderPage();
      await userEvent.click(screen.getByTestId("staff-access-approve-button"));

      expect(await screen.findByTestId("staff-access-ceremony-failed")).toHaveTextContent(
        "The passkey check did not finish",
      );
      expect(backend.callsTo("approve")).toEqual([]);
    });
  });
});

describe("given the request is not the operator's", () => {
  beforeEach(() => {
    backend.approvalError = handledError("not_found", 404);
  });

  /** @scenario "A request the operator may not open reads as not found" */
  it("reads as not found with no approve button", () => {
    renderPage();
    expect(screen.getByTestId("staff-access-request-not-found")).toHaveTextContent(
      "Request not found",
    );
    expect(screen.queryByTestId("staff-access-approve-button")).toBeNull();
  });
});

describe("given a request that is no longer pending", () => {
  /** @scenario "A decided or expired request shows its outcome and offers no approval" */
  it.each([
    [
      "expired by the clock",
      { status: "pending" as const, expiresAt: "2026-01-01T00:00:00.000Z" },
      "staff-access-phase-expired",
    ],
    ["expired", { status: "expired" as const }, "staff-access-phase-expired"],
    ["approved", { status: "approved" as const }, "staff-access-phase-approved"],
    [
      "approved but never picked up",
      { status: "approved" as const, expiresAt: "2026-01-01T00:00:00.000Z" },
      "staff-access-phase-lapsed",
    ],
    [
      "expired after approval",
      { status: "expired" as const, approvedAt: "2026-01-01T00:00:00.000Z" },
      "staff-access-phase-lapsed",
    ],
    ["redeemed", { status: "redeemed" as const }, "staff-access-phase-live"],
    [
      "redeemed past its hour",
      {
        status: "redeemed" as const,
        redeemedAt: "2026-01-01T00:00:00.000Z",
        accessExpiresAt: "2026-01-01T01:00:00.000Z",
      },
      "staff-access-phase-ended",
    ],
    [
      "expired after its session",
      {
        status: "expired" as const,
        approvedAt: "2026-01-01T00:00:00.000Z",
        redeemedAt: "2026-01-01T00:00:00.000Z",
      },
      "staff-access-phase-ended",
    ],
    ["denied", { status: "denied" as const }, "staff-access-phase-denied"],
    ["revoked", { status: "revoked" as const }, "staff-access-phase-revoked"],
  ])("shows a request %s as its outcome", (_label, overrides, testId) => {
    backend.approval = approvalView(overrides);
    renderPage();

    expect(screen.getByTestId(testId)).toBeInTheDocument();
    expect(screen.queryByTestId("staff-access-approve-button")).toBeNull();
    expect(screen.queryByTestId("staff-access-approval-countdown")).toBeNull();
  });

  describe("when it expires while the operator is approving", () => {
    beforeEach(() => {
      backend.handlers.approve = () => {
        backend.approval = approvalView({ status: "expired" });
        throw handledError("request_expired", 410, { requestId: "sar_1" });
      };
    });

    it("rereads the request and shows it expired", async () => {
      renderPage();
      await userEvent.click(screen.getByTestId("staff-access-approve-button"));

      await waitFor(() =>
        expect(screen.getByTestId("staff-access-phase-expired")).toBeInTheDocument(),
      );
    });
  });
});
