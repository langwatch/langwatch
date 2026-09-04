/**
 * The credential half of the onboarding model provider step.
 *
 * A SEAM, ON PURPOSE: the form belongs to the model-provider family and is
 * mounted here rather than copied, and the step's own test mocks this module so
 * what it proves is the placement and the advance, not the save mechanics.
 * `modelProviderId: "new"` keeps onboarding on a fresh row instead of editing
 * whatever the organization already holds for that provider.
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
