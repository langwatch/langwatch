/**
 * Rotating one key: the confirmation, the mutation, then the new secret shown once through the
 * same dialog a mint uses. Spec: specs/api-keys/api-key-rotation.feature
 */
import type { ApiKeyListEntry } from "@langwatch/api-key-contract";
import type { WireOf } from "@langwatch/api/web";
import { useState } from "react";

import { apiKeyApi } from "../../behavior/api-key-api.ts";
import { useApiKeyHost } from "../../model/api-key-host.ts";
import { findBindingAtScope } from "../../model/api-key-permissions.ts";
import { RotateConfirmDialog } from "../blocks/rotate-confirm-dialog.tsx";
import { TokenCreatedDialog } from "./token-created-dialog.tsx";

type ApiKeyRow = WireOf<ApiKeyListEntry>;
type OrgProject = { id: string; name: string; teamId: string };

export function RotateApiKeyFlow({
  apiKey,
  organizationId,
  projectId,
  endpoint,
  orgProjects,
  onClose,
}: {
  /** The key to rotate; null when no rotation is asked for. */
  apiKey: ApiKeyRow | null;
  organizationId: string;
  projectId: string | undefined;
  endpoint: string;
  orgProjects: OrgProject[];
  onClose: () => void;
}) {
  const host = useApiKeyHost();
  const rotateMutation = apiKeyApi.apiKey.rotate.useMutation();
  const queryClient = apiKeyApi.useUtils();
  const [rotated, setRotated] = useState<{ token: string; apiKey: ApiKeyRow } | null>(null);

  const handleConfirm = (apiKeyId: string) => {
    const rotating = apiKey;
    rotateMutation.mutate(
      { organizationId, apiKeyId },
      {
        onSuccess: (result) => {
          if (rotating) setRotated({ token: result.token, apiKey: rotating });
          onClose();
          void queryClient.apiKey.list.invalidate();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't rotate API key" }),
      },
    );
  };

  return (
    <>
      <RotateConfirmDialog
        apiKey={apiKey}
        isRotating={rotateMutation.isPending}
        onCancel={onClose}
        onConfirm={handleConfirm}
      />
      <TokenCreatedDialog
        newToken={rotated?.token ?? null}
        title="Key rotated"
        keyName={rotated?.apiKey.name}
        projectId={projectId}
        endpoint={endpoint}
        orgProjects={orgProjects.filter((project) =>
          findBindingAtScope({
            bindings: rotated?.apiKey.grants,
            scopeType: "PROJECT",
            scopeId: project.id,
            organizationId,
            orgProjects,
          }),
        )}
        onClose={() => setRotated(null)}
      />
    </>
  );
}
