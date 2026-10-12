/**
 * @vitest-environment jsdom
 *
 * See specs/licensing/license-activation-ui.feature. Each way of giving the
 * License page a license (activation code field, license key field, uploaded
 * file) accepts either form, and the value's shape decides whether it is
 * redeemed as a code or stored as a key.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LicenseStatus } from "../../LicenseStatus";

const { uploadMutate, activateMutate } = vi.hoisted(() => ({
  uploadMutate: vi.fn(),
  activateMutate: vi.fn(),
}));

vi.mock("~/utils/api", () => {
  const idleMutation = (mutate: (...args: unknown[]) => void) => ({
    useMutation: () => ({ mutate, isPending: false }),
  });
  return {
    api: {
      useUtils: () => ({ invalidate: vi.fn() }),
      license: {
        getStatus: {
          useQuery: () => ({
            data: { hasLicense: false, valid: false },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }),
        },
        upload: idleMutation(uploadMutate),
        activate: idleMutation(activateMutate),
        remove: idleMutation(vi.fn()),
        refresh: idleMutation(vi.fn()),
      },
    },
  };
});

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: false } }),
}));

const ACTIVATION_CODE = "LW-ABCD-EFGH-JKMN-PQRS";
const NORMALISED_CODE = "LWABCDEFGHJKMNPQRS";
const SIGNED_LICENSE_KEY = `eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0xIn0sInNpZ25hdHVyZSI6IiJ9${"A".repeat(200)}`;

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderPage = () =>
  render(<LicenseStatus organizationId="org-1" />, { wrapper: Wrapper });

const activateButton = () =>
  screen.getByRole("button", { name: "Activate License" });

const uploadFileHolding = async ({
  user,
  container,
  content,
}: {
  user: ReturnType<typeof userEvent.setup>;
  container: HTMLElement;
  content: string;
}) => {
  await user.click(screen.getByText("Upload license file"));
  const fileInput = container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await user.upload(
    fileInput,
    new File([content], "acme.langwatch-license", { type: "text/plain" }),
  );
  await user.click(activateButton());
};

describe("License page without a license", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the activation code method is selected", () => {
    describe("when an activation code is typed and submitted", () => {
      /** @scenario "an activation code entered in the activation code field is redeemed" */
      it("redeems the code with LangWatch", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.type(
          screen.getByRole("textbox", { name: "Activation code" }),
          ACTIVATION_CODE,
        );
        await user.click(activateButton());

        expect(activateMutate).toHaveBeenCalledWith({
          organizationId: "org-1",
          code: NORMALISED_CODE,
        });
        expect(uploadMutate).not.toHaveBeenCalled();
      });
    });

    describe("when a signed license key is pasted and submitted", () => {
      /** @scenario "a signed license key pasted in the activation code field is stored" */
      it("stores the key and redeems no code", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(
          screen.getByRole("textbox", { name: "Activation code" }),
        );
        await user.paste(`  ${SIGNED_LICENSE_KEY} `);
        await user.click(activateButton());

        expect(uploadMutate).toHaveBeenCalledWith({
          organizationId: "org-1",
          licenseKey: SIGNED_LICENSE_KEY,
        });
        expect(activateMutate).not.toHaveBeenCalled();
      });
    });

    describe("when a mistyped code is submitted", () => {
      it("sends it as a code so the answer names a malformed code", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.type(
          screen.getByRole("textbox", { name: "Activation code" }),
          "LW-ABCD-EFGH",
        );
        await user.click(activateButton());

        expect(activateMutate).toHaveBeenCalledWith({
          organizationId: "org-1",
          code: "LW-ABCD-EFGH",
        });
        expect(uploadMutate).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the license key method is selected", () => {
    describe("when an activation code is pasted and submitted", () => {
      /** @scenario "an activation code pasted in the license key field is redeemed" */
      it("redeems the code and stores no key", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(screen.getByText("Enter license key"));
        await user.click(screen.getByRole("textbox", { name: "License key" }));
        await user.paste(`${ACTIVATION_CODE}\n`);
        await user.click(activateButton());

        expect(activateMutate).toHaveBeenCalledWith({
          organizationId: "org-1",
          code: NORMALISED_CODE,
        });
        expect(uploadMutate).not.toHaveBeenCalled();
      });
    });

    describe("when a signed license key is pasted and submitted", () => {
      it("stores the key", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(screen.getByText("Enter license key"));
        await user.click(screen.getByRole("textbox", { name: "License key" }));
        await user.paste(SIGNED_LICENSE_KEY);
        await user.click(activateButton());

        expect(uploadMutate).toHaveBeenCalledWith({
          organizationId: "org-1",
          licenseKey: SIGNED_LICENSE_KEY,
        });
        expect(activateMutate).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the file upload method is selected", () => {
    describe("when the uploaded file holds an activation code", () => {
      /** @scenario "an uploaded file holding an activation code is redeemed" */
      it("redeems the code from the file", async () => {
        const user = userEvent.setup();
        const { container } = renderPage();

        await uploadFileHolding({
          user,
          container,
          content: `${ACTIVATION_CODE}\n`,
        });

        await waitFor(() =>
          expect(activateMutate).toHaveBeenCalledWith({
            organizationId: "org-1",
            code: NORMALISED_CODE,
          }),
        );
        expect(uploadMutate).not.toHaveBeenCalled();
      });
    });

    describe("when the uploaded file holds a signed license key", () => {
      /** @scenario "an uploaded file holding a signed license key is stored" */
      it("stores the key from the file", async () => {
        const user = userEvent.setup();
        const { container } = renderPage();

        await uploadFileHolding({
          user,
          container,
          content: SIGNED_LICENSE_KEY,
        });

        await waitFor(() =>
          expect(uploadMutate).toHaveBeenCalledWith({
            organizationId: "org-1",
            licenseKey: SIGNED_LICENSE_KEY,
          }),
        );
        expect(activateMutate).not.toHaveBeenCalled();
      });
    });
  });
});
