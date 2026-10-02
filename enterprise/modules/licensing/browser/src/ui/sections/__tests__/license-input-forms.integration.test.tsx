/**
 * @vitest-environment jsdom
 *
 * specs/licensing/license-activation-ui.feature: every field of the License
 * page takes an activation code or a signed license key, told apart by shape.
 */

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LicensingHostApi, LicensingHostProvider } from "../../../model/licensing-host.ts";
import { LicenseStatusPanel } from "../license-status-panel.tsx";

const { upload, activate } = vi.hoisted(() => ({ upload: vi.fn(), activate: vi.fn() }));

vi.mock("../../../behavior/licensing-api.ts", () => ({
  licensingApi: {
    license: {
      getStatus: {
        useQuery: () => ({
          data: { hasLicense: false },
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
    upload,
    activate,
    remove: vi.fn(),
    refresh: vi.fn(),
    isUploading: false,
    isRemoving: false,
    isRefreshing: false,
  }),
}));

class TestHost extends LicensingHostApi {
  organizationId() {
    return "org-1";
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
  failed() {}
  canManageOrganization() {
    return true;
  }
  describeFailure({ fallbackTitle }: { fallbackTitle: string }) {
    return fallbackTitle;
  }
}

const Wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">
    <LicensingHostProvider value={new TestHost()}>{children}</LicensingHostProvider>
  </DesignSystemProvider>
);

const ACTIVATION_CODE = "LW-ABCD-EFGH-JKMN-PQRS";
const NORMALISED_CODE = "LWABCDEFGHJKMNPQRS";
const SIGNED_LICENSE_KEY = Buffer.from(
  JSON.stringify({
    data: { licenseId: "lic-1", organizationName: "ACME" },
    signature: "a".repeat(80),
  }),
).toString("base64");

const renderPage = () =>
  render(<LicenseStatusPanel organizationId="org-1" />, { wrapper: Wrapper });

const activateButton = () => screen.getByTestId("license-activate");

async function uploadFileHolding({
  user,
  container,
  content,
}: {
  user: ReturnType<typeof userEvent.setup>;
  container: HTMLElement;
  content: string;
}) {
  await user.click(screen.getByText("License file"));
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) throw new Error("the file method rendered no file input");
  await user.upload(
    fileInput,
    new File([content], "acme.langwatch-license", { type: "text/plain" }),
  );
  await user.click(activateButton());
}

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
  upload.mockClear();
  activate.mockClear();
});

afterEach(() => cleanup());

describe("the License page without a license", () => {
  describe("given the activation code method is selected", () => {
    /** @scenario "an activation code entered in the activation code field is redeemed" */
    it("redeems a typed code with LangWatch", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(screen.getByTestId("license-activation-code"), ACTIVATION_CODE);
      await user.click(activateButton());

      expect(activate).toHaveBeenCalledWith(NORMALISED_CODE);
      expect(upload).not.toHaveBeenCalled();
    });

    /** @scenario "a signed license key pasted in the activation code field is stored" */
    it("stores a pasted signed key and redeems no code", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByTestId("license-activation-code"));
      await user.paste(SIGNED_LICENSE_KEY);
      await user.click(activateButton());

      expect(upload).toHaveBeenCalledWith(SIGNED_LICENSE_KEY);
      expect(activate).not.toHaveBeenCalled();
    });

    it("sends a short mistyped value as a code, so the answer names a malformed code", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(screen.getByTestId("license-activation-code"), "LW-ABCD");
      await user.click(activateButton());

      expect(activate).toHaveBeenCalledWith("LW-ABCD");
      expect(upload).not.toHaveBeenCalled();
    });
  });

  describe("given the license key method is selected", () => {
    /** @scenario "an activation code pasted in the license key field is redeemed" */
    it("redeems a pasted code and stores no key", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByText("License key"));
      await user.click(screen.getByTestId("license-key-input"));
      await user.paste(ACTIVATION_CODE);
      await user.click(activateButton());

      expect(activate).toHaveBeenCalledWith(NORMALISED_CODE);
      expect(upload).not.toHaveBeenCalled();
    });
  });

  describe("given the file upload method is selected", () => {
    /** @scenario "an uploaded file holding an activation code is redeemed" */
    it("redeems the code from the file", async () => {
      const user = userEvent.setup();
      const { container } = renderPage();

      await uploadFileHolding({ user, container, content: `${ACTIVATION_CODE}\n` });

      await waitFor(() => expect(activate).toHaveBeenCalledWith(NORMALISED_CODE));
      expect(upload).not.toHaveBeenCalled();
    });

    /** @scenario "an uploaded file holding a signed license key is stored" */
    it("stores the key from the file", async () => {
      const user = userEvent.setup();
      const { container } = renderPage();

      await uploadFileHolding({ user, container, content: SIGNED_LICENSE_KEY });

      await waitFor(() => expect(upload).toHaveBeenCalledWith(SIGNED_LICENSE_KEY));
      expect(activate).not.toHaveBeenCalled();
    });
  });
});
