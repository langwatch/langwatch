// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The ingestion source edit drawer, opened by address: `?drawer.open=editIngestionSource&drawer.sourceId=<id>`. */
import { useDrawer } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { HandledErrorAlert } from "@langwatch/error-views";
import type { ReactNode } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { useGovernanceScope } from "../../../behavior/governance-session.ts";
import { useGovernanceHost } from "../../../model/governance-host.ts";
import { PermissionRequiredNotice } from "../../elements/permission-required-notice.tsx";
import { useDestinationContext } from "./ingestion-source-forms.ts";
import { SourceEditDrawer } from "./inventory/source-edit-drawer.tsx";

/**
 * An address can open this drawer for anyone and at any moment: a shared link,
 * a restored tab, a source archived since. So every state before "here is the
 * form" is an open drawer that says which state it is, never a blank page with
 * the drawer still named in the address, and never a form the server refuses.
 */
export function RoutedSourceEditDrawer({ sourceId }: { sourceId?: string }) {
  const { closeDrawer } = useDrawer();
  const { organization, hasAnyPermission } = useGovernanceScope();
  // Mounted at the app root, not behind the section gate: until the session
  // settles every grant reads false, so a manager would see "not allowed".
  const isSettled = useGovernanceHost().isSettled();
  const organizationId = organization?.id ?? "";
  const canManage = hasAnyPermission("ingestionSources:manage");
  const canRead = hasAnyPermission("ingestionSources:view");
  const destinationCtx = useDestinationContext(organization);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const utils = api.useUtils();

  const sourcesQuery = api.ingestionSources.list.useQuery(
    { organizationId },
    { enabled: !!organizationId && canManage },
  );
  const update = api.ingestionSources.update.useMutation({
    onSuccess: () => {
      void utils.ingestionSources.list.invalidate({ organizationId });
      closeDrawer();
      toaster.create({ title: "Source updated", type: "success" });
    },
    onError: (e) => showErrorToast({ error: e, fallbackTitle: "Couldn't update the source" }),
  });

  if (isSettled && !canManage) {
    return (
      <SourceUnavailableDrawer onClose={closeDrawer}>
        <PermissionRequiredNotice
          permission="ingestionSources:manage"
          detail={
            canRead
              ? "Editing a source needs this grant. You can still read it from the source list."
              : "Editing a source needs this grant."
          }
        />
      </SourceUnavailableDrawer>
    );
  }

  // `isPending`, not `isLoading`: a read not yet running (no organization, or
  // paused offline) has no answer either, and must not read as "no such source".
  if (!isSettled || !organizationId || sourcesQuery.isPending) {
    return (
      <SourceUnavailableDrawer onClose={closeDrawer}>
        <SkeletonRows rows={6} label="Loading the source" />
      </SourceUnavailableDrawer>
    );
  }

  const source = sourcesQuery.data?.find((s) => s.id === sourceId);

  if (!source) {
    return (
      <SourceUnavailableDrawer onClose={closeDrawer}>
        {sourcesQuery.error ? (
          <HandledErrorAlert
            error={sourcesQuery.error}
            fallbackTitle="Couldn't load this source"
            onRetry={() => void sourcesQuery.refetch()}
          />
        ) : (
          <VStack align="start" gap={1} data-testid="edit-source-not-found">
            <Text fontWeight="medium">This source isn't in the organization's list</Text>
            <Text textStyle="sm" color="fg.muted">
              It may have been archived, or the link names a source from another organization.
            </Text>
          </VStack>
        )}
      </SourceUnavailableDrawer>
    );
  }

  return (
    <SourceEditDrawer
      organizationId={organizationId}
      destinationCtx={destinationCtx}
      source={source}
      onClose={closeDrawer}
      onSubmit={(input) => update.mutate(input)}
      isPending={update.isPending}
      refusal={update.error}
    />
  );
}

/** The drawer for every state that has no source to edit: no Save, only a way out. */
function SourceUnavailableDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Drawer title="Edit source" onClose={onClose}>
      {children}
    </Drawer>
  );
}
