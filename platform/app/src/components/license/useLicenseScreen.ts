/**
 * What the License page needs to render: the organization's license as the
 * server reports it, the two things an operator can type (a pasted key and an
 * activation code), and the commands that act on them.
 *
 * The page asks for this once and reads it; the typing and the commands live
 * together because activating clears both inputs whichever one was used.
 */
import { useState } from "react";
import { api } from "~/utils/api";
import { normalizeKeyForActivation } from "./licenseStatusUtils";
import { useLicenseActions } from "./useLicenseActions";

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

  const activateTypedKey = (text: string) => {
    const normalizedKey = normalizeKeyForActivation(text);
    if (normalizedKey) upload(normalizedKey);
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
      const code = activationCode.trim();
      if (code) activate(code);
    },
    activateKey: () => activateTypedKey(licenseKey),
    activateFile: activateTypedKey,
    remove,
    refresh,
    isUploading,
    isRemoving,
    isRefreshing,
  };
}
