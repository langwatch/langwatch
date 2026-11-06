/**
 * @vitest-environment jsdom
 *
 * Tests expired license enforcement: metering still runs, over-seats callout shows,
 * and unsigned licenses display nothing.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { LicenseStatus as LicenseStatusPayload } from "@langwatch/enterprise-licensing-contract";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LicensingHostApi, LicensingHostProvider } from "../../../model/licensing-host.ts";
import { LicenseStatusPanel } from "../license-status-panel.tsx";

const { statusResult, actions } = vi.hoisted(() => ({
  statusResult: { current: undefined as unknown },
  actions: {
    upload: vi.fn(),
    activate: vi.fn(),
    remove: vi.fn(),
    refresh: vi.fn(),
  },
}));

class TestHost extends LicensingHostApi {
  constructor(private readonly canManage: boolean) {
    super();
  }
  organizationId() {
    return "org-123";
  }
  isSaaS() {
    return false;
  }
  isDeploymentSettled() {
    return true;
  }
  licensePurchaseUrl() {
    return undefined;
  }
  refreshPlanDerivedState() {}
  succeeded() {}
  warned() {}
  informed() {}
  failed() {}
  canManageOrganization() {
    return this.canManage;
  }
  describeFailure({ fallbackTitle }: { fallbackTitle: string }) {
    return fallbackTitle;
  }
}

vi.mock("../../../behavior/licensing-api.ts", () => ({
  licensingApi: {
    license: {
      getStatus: {
        useQuery: () => ({
          data: statusResult.current,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("../use-license-actions.ts", () => ({
  useLicenseActions: () => ({
    ...actions,
    isUploading: false,
    isRemoving: false,
    isRefreshing: false,
  }),
}));

const resourceCounts = {
  currentMembers: 8,
  maxMembers: 5,
  currentMembersLite: 0,
  maxMembersLite: 5,
  currentMessagesPerMonth: 0,
  maxMessagesPerMonth: 1_000_000,
};

const lapsedStatus: LicenseStatusPayload = {
  hasLicense: true,
  valid: false,
  expired: true,
  plan: "ENTERPRISE",
  planName: "Enterprise",
  expiresAt: "2020-01-01T00:00:00Z",
  organizationName: "Acme Corp",
  ...resourceCounts,
};

const unsignedStatus: LicenseStatusPayload = {
  ...lapsedStatus,
  expired: false,
};

const validStatus = ({ connected }: { connected: boolean }): LicenseStatusPayload => ({
  hasLicense: true,
  valid: true,
  connected,
  plan: "ENTERPRISE",
  planName: "Enterprise",
  expiresAt: "2099-01-01T00:00:00Z",
  organizationName: "Acme Corp",
  ...resourceCounts,
  currentMembers: 3,
});

const renderWith = (status: LicenseStatusPayload, { canManage = true } = {}) => {
  statusResult.current = status;
  return renderWithDesignSystem(
    <LicensingHostProvider value={new TestHost(canManage)}>
      <LicenseStatusPanel organizationId="org-123" />
    </LicensingHostProvider>,
  );
};

const SIGNED_LICENSE_KEY = Buffer.from(
  JSON.stringify({ data: { licenseId: "lic-2" }, signature: "a".repeat(80) }),
).toString("base64");

beforeAll(() => {
  // jsdom has no ResizeObserver, which the segmented control measures with.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockClear();
});

describe("LicenseStatusPanel", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a license whose term has ended", () => {
    /** @scenario The license page says what the lapse changed and what it did not */
    it("says nothing was switched off and names what renewal buys back", () => {
      renderWith(lapsedStatus);

      expect(screen.getByText("Expired")).toBeDefined();
      expect(screen.getByText(/Nothing was switched off/i)).toBeDefined();
      expect(screen.getByText(/stay as they are/i)).toBeDefined();
      expect(screen.getByText(/Renew to add members again/i)).toBeDefined();
    });

    /** @scenario An organization over the seats of a lapsed license is asked to reconcile */
    it("still asks an over-seats organization to reconcile", () => {
      renderWith(lapsedStatus);

      expect(screen.getByTestId("over-seats-callout")).toBeDefined();
      expect(screen.getByText(/3 members are over the seats your license covers/i)).toBeDefined();
    });
  });

  describe("given a license we did not sign", () => {
    /** @scenario A license we did not sign is not called expired */
    it("calls it invalid and meters nothing, even though it claims a past date", () => {
      renderWith(unsignedStatus);

      expect(screen.getByText("Invalid")).toBeDefined();
      expect(screen.getByText(/Your license is invalid/i)).toBeDefined();
      expect(screen.queryByText(/Nothing was switched off/i)).toBeNull();
      expect(screen.queryByTestId("over-seats-callout")).toBeNull();
    });
  });

  describe("given a valid license", () => {
    /** @scenario Refresh is offered on a connected license only */
    it("offers refresh when the license names a hosted service", () => {
      renderWith(validStatus({ connected: true }));

      expect(screen.getByTestId("refresh-license")).toBeDefined();
    });

    /** @scenario Refresh is offered on a connected license only */
    it("offers no refresh on an offline license", () => {
      renderWith(validStatus({ connected: false }));

      expect(screen.queryByTestId("refresh-license")).toBeNull();
    });
  });

  describe("given a connected license whose term ended", () => {
    /** @scenario Refresh is offered on an expired connected licence */
    it("offers refresh so a renewal issued after expiry can be collected", async () => {
      renderWith({ ...lapsedStatus, connected: true });

      await userEvent.setup().click(screen.getByTestId("refresh-license"));

      expect(actions.refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an installed license an admin renews offline", () => {
    /** @scenario An admin replaces the installed licence with a new key */
    it("stores the new key over the installed one without removing it first", async () => {
      const user = userEvent.setup();
      renderWith(validStatus({ connected: false }));

      await user.click(screen.getByTestId("license-replace"));
      await user.click(screen.getByText("License key"));
      await user.click(screen.getByTestId("license-key-input"));
      await user.paste(SIGNED_LICENSE_KEY);
      await user.click(screen.getByTestId("license-replace-submit"));

      expect(actions.upload).toHaveBeenCalledWith(SIGNED_LICENSE_KEY);
      expect(actions.remove).not.toHaveBeenCalled();
    });

    /** @scenario Removing a licence asks first and says what the organization loses */
    it("asks before removing and names the plan and capabilities lost", async () => {
      const user = userEvent.setup();
      renderWith(validStatus({ connected: false }));

      await user.click(screen.getByTestId("license-remove"));
      const dialog = await screen.findByRole("alertdialog");

      expect(within(dialog).getByText(/open source plan/)).toBeDefined();
      expect(
        within(dialog).getByText(/single sign-on, SCIM provisioning and audit logs/),
      ).toBeDefined();
      expect(actions.remove).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: "Remove license" }));
      expect(actions.remove).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a license set in LANGWATCH_LICENSE_KEY", () => {
    /** @scenario The License page shows a licence installed from the environment */
    it("shows its plan, seats and expiry, says where it came from and offers no removal", () => {
      renderWith({
        hasLicense: true,
        valid: true,
        connected: false,
        source: "environment",
        plan: "ENTERPRISE",
        planName: "Enterprise",
        expiresAt: "2099-01-01T00:00:00Z",
        organizationName: "Acme Corp",
        ...resourceCounts,
        currentMembers: 3,
      });

      expect(within(screen.getByTestId("license-plan")).getByText("Enterprise")).toBeDefined();
      expect(within(screen.getByTestId("license-seats")).getByText("3 / 5")).toBeDefined();
      expect(within(screen.getByTestId("license-expires")).getByText(/2099/)).toBeDefined();
      expect(screen.getByText(/Installed from the environment/)).toBeDefined();
      expect(screen.queryByTestId("license-remove")).toBeNull();
    });
  });

  describe("given a member without organization:manage", () => {
    /** @scenario A member without organization:manage sees no licence actions */
    it("shows the license with no remove, replace or refresh", () => {
      renderWith(validStatus({ connected: true }), { canManage: false });

      expect(screen.getByTestId("license-plan")).toBeDefined();
      expect(screen.queryByTestId("license-remove")).toBeNull();
      expect(screen.queryByTestId("license-replace")).toBeNull();
      expect(screen.queryByTestId("refresh-license")).toBeNull();
    });

    /** @scenario A member without organization:manage cannot activate a licence */
    it("offers no activation and says an admin can activate one", () => {
      renderWith({ hasLicense: false, valid: false }, { canManage: false });

      expect(screen.queryByTestId("license-activate")).toBeNull();
      expect(screen.getByText("An organization admin can activate a license.")).toBeDefined();
    });
  });

  describe("given a license file", () => {
    async function dropFile({ name, content }: { name: string; content: string }) {
      const user = userEvent.setup();
      const { container } = renderWith({ hasLicense: false, valid: false });
      await user.click(screen.getByText("License file"));
      const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
      if (!fileInput) throw new Error("the file method rendered no file input");
      await user.upload(fileInput, new File([content], name, { type: "text/plain" }));
      return user;
    }

    /** @scenario A licence file renamed by a mail client is accepted by its content */
    it("takes a renamed file by the key inside it", async () => {
      const user = await dropFile({ name: "license.txt", content: `${SIGNED_LICENSE_KEY}\n` });

      await waitFor(() => expect(screen.getByText("license.txt")).toBeDefined());
      await user.click(screen.getByTestId("license-activate"));

      expect(actions.upload).toHaveBeenCalledWith(SIGNED_LICENSE_KEY);
    });

    /** @scenario A file that holds no licence is refused with a reason */
    it("says the file holds no license and sends nothing", async () => {
      await dropFile({ name: "notes.txt", content: "Meeting notes, nothing to see here." });

      expect(await screen.findByTestId("license-file-error")).toBeDefined();
      expect(screen.getByText(/does not contain a LangWatch license/)).toBeDefined();
      expect(actions.upload).not.toHaveBeenCalled();
      expect(actions.activate).not.toHaveBeenCalled();
    });

    it("refuses a long base64 blob that does not decode to a signed licence", async () => {
      await dropFile({
        name: "photo.txt",
        content: Buffer.from("x".repeat(200)).toString("base64"),
      });

      expect(await screen.findByTestId("license-file-error")).toBeDefined();
      expect(actions.upload).not.toHaveBeenCalled();
    });

    it("says so when the file cannot be read", async () => {
      const unreadable = new File(["x"], "license.txt", { type: "text/plain" });
      Object.defineProperty(unreadable, "text", { value: () => Promise.reject(new Error("gone")) });
      const user = userEvent.setup();
      const { container } = renderWith({ hasLicense: false, valid: false });
      await user.click(screen.getByText("License file"));
      const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
      if (!fileInput) throw new Error("the file method rendered no file input");
      await user.upload(fileInput, unreadable);

      expect(await screen.findByText(/could not be read/)).toBeDefined();
      expect(actions.upload).not.toHaveBeenCalled();
    });
  });
});
