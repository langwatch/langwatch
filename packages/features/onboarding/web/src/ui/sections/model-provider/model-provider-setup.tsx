/**
 * The credential half of the onboarding model provider step.
 */

import { EditModelProviderForm } from "@langwatch/model-provider-web/components/EditModelProviderForm";
import type React from "react";
import { useOnboardingHost } from "../../../model/onboarding-host";

interface ModelProviderSetupProps {
  providerKey: string;
  /** Called once the credential is stored, so the flow can advance. */
  onComplete: () => void;
}

export function ModelProviderSetup({
  providerKey,
  onComplete,
}: ModelProviderSetupProps): React.ReactElement {
  const { organization, project } = useOnboardingHost().scope();

  return (
    <EditModelProviderForm
      key={providerKey}
      providerKey={providerKey}
      modelProviderId="new"
      organizationId={organization?.id}
      projectId={project?.id}
      onSaved={onComplete}
    />
  );
}
