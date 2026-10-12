/**
 * What the License page needs to render: the organization's license as the
 * server reports it, the two things an operator can type (a pasted key and an
 * activation code), and the commands that act on them.
 *
 * The page asks for this once and reads it; the typing and the commands live
 * together because activating clears both inputs whichever one was used.
 */
import { detectLicenseInputForm } from "@ee/licensing/licenseInputForm";
import { useState } from "react";
import { api } from "~/utils/api";
import { useLicenseActions } from "./useLicenseActions";

/** A signed license key is a base64 blob of a few hundred characters. */
const MIN_LICENSE_KEY_LENGTH = 64;

export function useLicenseScreen(organizationId: string) {
  const [licenseKey, setLicenseKey] = useState("");
  const [activationCode, setActivationCode] = useState("");

  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = api.license.getStatus.useQuery(
    { organizationId },
    {
      enabled: !!organizationId,
      refetchOnWindowFocus: false,
      staleTime: 30_000, // Consider fresh for 30 seconds
    },
  );

  const {
    upload,
    activate,
    remove,
    refresh,
    isUploading,
    isRemoving,
    isRefreshing,
  } = useLicenseActions({
    organizationId,
    onUploadSuccess: () => {
      setLicenseKey("");
      setActivationCode("");
      void refetch();
    },
    onRemoveSuccess: () => {
      void refetch();
    },
  });

  // Every field accepts both forms, the same as LANGWATCH_LICENSE_KEY: the
  // value's shape decides whether it is redeemed as a code or stored as a key,
  // whichever field or file it came through.
  const submitLicense = (text: string) => {
    const input = detectLicenseInputForm(text);
    if (input.form === "activation_code") activate(input.code);
    else if (input.form === "license_key") upload(input.licenseKey);
  };

  return {
    status,
    isLoading,
    isError,
    retry: () => void refetch(),
    licenseKey,
    setLicenseKey,
    activationCode,
    setActivationCode,
    activateCode: () => {
      // A short value that is not a code is a mistyped code, not a license
      // key: redeeming it gets the connect host's "malformed code" answer
      // instead of a license format error.
      const typed = activationCode.trim();
      if (
        detectLicenseInputForm(typed).form === "license_key" &&
        typed.length < MIN_LICENSE_KEY_LENGTH
      ) {
        activate(typed);
        return;
      }
      submitLicense(activationCode);
    },
    activateKey: () => submitLicense(licenseKey),
    activateFile: submitLicense,
    remove,
    refresh,
    isUploading,
    isRemoving,
    isRefreshing,
  };
}
