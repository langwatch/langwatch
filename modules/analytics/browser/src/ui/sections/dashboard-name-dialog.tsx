/**
 * Naming a new dashboard: mounted inline, not through the drawer registry
 * — that registry is application chrome a packaged screen can't supply,
 * and this dialog has exactly one opener.
 */

import { dashboardNameSchema } from "@langwatch/dashboard-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import { Field, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useRef, useState } from "react";

import { analyticsApi } from "../../behavior/analytics-api.ts";
import { useDashboards } from "../../behavior/use-dashboards.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";

export function DashboardNameDialog({
  open,
  onOpenChange,
  projectSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
}) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";

  const dashboardsQuery = useDashboards({ projectId });
  const createDashboard = analyticsApi.dashboards.create.useMutation();

  const dashboards = dashboardsQuery.data ?? [];
  const defaultName = `Dashboard ${dashboards.length + 1}`;

  const [dashboardName, setDashboardName] = useState(defaultName);
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameMissing = attempted && !dashboardName.trim();

  useEffect(() => {
    if (!open) return;
    setDashboardName((current) => (current.trim() ? current : defaultName));
  }, [defaultName, open]);

  const close = () => {
    setAttempted(false);
    onOpenChange(false);
  };

  const handleConfirm = () => {
    if (createDashboard.isPending) return;
    if (!dashboardName.trim()) {
      setAttempted(true);
      inputRef.current?.focus();
      return;
    }

    createDashboard.mutate(
      { projectId, name: dashboardName.trim() },
      {
        onSuccess: (newDashboard) => {
          void dashboardsQuery.refetch();
          host.navigate(`/${projectSlug}/analytics/reports?dashboard=${newDashboard.id}`);
          close();
        },
        // The words a reader sees come from the host's code-keyed registry, so
        // the raw error travels and this only names what was being attempted.
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't create this dashboard" }),
      },
    );
  };

  return (
    <Dialog
      open={open}
      size="sm"
      onClose={close}
      title="Create dashboard"
      busy={createDashboard.isPending}
      onSubmit={handleConfirm}
      primaryAction={{
        label: "Create Dashboard",
        type: "submit",
        loading: createDashboard.isPending,
        "data-testid": "analytics-dashboard-create-confirm",
      }}
    >
      <VStack align="stretch" gap={2}>
        <Text textStyle="sm" color="fg.muted">
          Give it a name that identifies what this dashboard will focus on.
        </Text>
        <Field.Root invalid={nameMissing}>
          <Input
            ref={inputRef}
            aria-label="Dashboard name"
            data-testid="analytics-dashboard-name-input"
            placeholder="Dashboard name"
            maxLength={dashboardNameSchema.maxLength ?? undefined}
            value={dashboardName}
            onChange={(event) => setDashboardName(event.target.value)}
          />
          <Field.ErrorText>Enter a dashboard name.</Field.ErrorText>
        </Field.Root>
      </VStack>
    </Dialog>
  );
}
