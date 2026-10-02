// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The ingestion source edit drawer, opened by address: `?drawer.open=editIngestionSource&drawer.sourceId=<id>`. */
import { useDrawer } from "@langwatch/browser-host/drawer";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { useGovernanceScope } from "../../../behavior/governance-session.ts";
import { SourceEditDrawer } from "./governance-inventory.screen.tsx";
import { useDestinationContext } from "./ingestion-source-forms.ts";

export function RoutedSourceEditDrawer({ sourceId }: { sourceId?: string }) {
  const { closeDrawer } = useDrawer();
  const { organization, hasAnyPermission } = useGovernanceScope();
  const organizationId = organization?.id ?? "";
  const destinationCtx = useDestinationContext(organization);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const utils = api.useUtils();

  const sourcesQuery = api.ingestionSources.list.useQuery(
    { organizationId },
    { enabled: !!organizationId && hasAnyPermission("ingestionSources:view") },
  );
  const update = api.ingestionSources.update.useMutation({
    onSuccess: () => {
      void utils.ingestionSources.list.invalidate({ organizationId });
      closeDrawer();
      toaster.create({ title: "Source updated", type: "success" });
    },
    onError: (e) => showErrorToast({ error: e, fallbackTitle: "Couldn't update the source" }),
  });

  return (
    <SourceEditDrawer
      organizationId={organizationId}
      destinationCtx={destinationCtx}
      source={sourcesQuery.data?.find((s) => s.id === sourceId) ?? null}
      onClose={closeDrawer}
      onSubmit={(input) => update.mutate(input)}
      isPending={update.isPending}
    />
  );
}
