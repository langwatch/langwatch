// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { EnterpriseLock } from "@langwatch/browser-host/enterprise-lock";
import { Button, HStack, Spinner, VStack } from "@langwatch/design-system/primitives";
import { SettingsCard } from "@langwatch/design-system/settings-card";
import {
  SECURITY_LAKE_SOURCE_TYPE,
  type SecurityLakeConnectionTest,
} from "@langwatch/enterprise-governance-contract";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

import { api } from "../../../../behavior/governance-api.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../../behavior/governance-feedback.ts";
import { useGovernancePlan } from "../../../../behavior/governance-session.ts";
import { useGovernanceHost } from "../../../../model/governance-host.ts";
import {
  blankSecurityLakeForm,
  securityLakeCreateInput,
  securityLakeFormFromSource,
  type SecurityLakeFormValues,
  securityLakeTestInput,
  securityLakeUpdateInput,
} from "../../../../model/security-lake-form-state.ts";
import { SecurityLakeCallersList } from "./security-lake-callers-list.tsx";
import { SecurityLakeHealthPanel } from "./security-lake-health-panel.tsx";
import { SecurityLakeSourceForm } from "./security-lake-source-form.tsx";

interface LakeSource {
  id: string;
  name: string;
  sourceType: string;
  parserConfig?: Record<string, unknown> | null;
}

/** The Security Lake sources of the organisation, their health, and callers without traces. */
export function SecurityLakeSection({
  organizationId,
  canManage,
  sources,
  onChanged,
}: {
  organizationId: string;
  canManage: boolean;
  sources: LakeSource[] | undefined;
  onChanged: () => unknown;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const host = useGovernanceHost();
  const plan = useGovernancePlan();
  // The Security Lake procedures need Enterprise, so add and edit wait for the plan to allow them.
  const mayEdit = canManage && plan.isEnterprise && editing === null;
  const lockedByPlan = !plan.isLoading && !plan.isEnterprise;
  const lakes = (sources ?? []).filter((source) => source.sourceType === SECURITY_LAKE_SOURCE_TYPE);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const test = api.ingestionSources.securityLakeTestConnection.useMutation({
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't test the connection" }),
  });
  const edit = (id: string | null) => {
    test.reset();
    setEditing(id);
  };
  const done = ({ title, next = null }: { title: string; next?: string | null }) => {
    void onChanged();
    edit(next);
    toaster.create({ title, type: "success" });
  };
  const create = api.ingestionSources.securityLakeCreate.useMutation({
    // The new source opens in edit, where the generated external id is shown to copy.
    onSuccess: (source) => done({ title: "Security Lake source added", next: source.id }),
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't add the source" }),
  });
  const update = api.ingestionSources.securityLakeUpdate.useMutation({
    onSuccess: () => done({ title: "Security Lake source saved" }),
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't save the source" }),
  });
  const hasSource = lakes.length > 0;
  const callers = api.ingestionSources.securityLakeCallersWithoutTraces.useQuery(
    { organizationId },
    { enabled: !!organizationId && hasSource },
  );

  return (
    <VStack align="stretch" gap={4}>
      <SettingsCard
        title="AWS Security Lake"
        hint="Reads AI activity from the CloudTrail events your Security Lake collects."
        actions={
          mayEdit ? (
            <Button size="sm" variant="outline" onClick={() => edit("new")}>
              <Plus size={14} /> Add Security Lake source
            </Button>
          ) : undefined
        }
      >
        <VStack align="stretch" gap={6} padding={4}>
          {lockedByPlan && (
            <EnterpriseLock
              feature="AWS Security Lake"
              description="Read AI activity from the CloudTrail events your Security Lake collects."
              canManage={host.hasPermission("organization:manage")}
              canSeePlans={host.hasPermission("organization:view")}
              inset
              data-testid="security-lake-enterprise-lock"
            />
          )}
          {editing === "new" && (
            <SecurityLakeSourceForm
              initialValues={blankSecurityLakeForm()}
              isNew
              isSaving={create.isPending}
              onCancel={() => edit(null)}
              onSubmit={(values) =>
                create.mutate({ organizationId, ...securityLakeCreateInput(values) })
              }
            />
          )}
          {lakes.map((lake) =>
            editing === lake.id ? (
              <LakeSourceEdit
                key={lake.id}
                organizationId={organizationId}
                lake={lake}
                isSaving={update.isPending}
                isTesting={test.isPending}
                testResult={test.variables?.id === lake.id ? test.data : null}
                onCancel={() => edit(null)}
                onTestConnection={(values) =>
                  test.mutate({ organizationId, id: lake.id, ...securityLakeTestInput(values) })
                }
                onSubmit={(values) =>
                  update.mutate({ organizationId, id: lake.id, ...securityLakeUpdateInput(values) })
                }
              />
            ) : (
              <LakeSourceHealth
                key={lake.id}
                organizationId={organizationId}
                lake={lake}
                onEdit={mayEdit ? () => edit(lake.id) : undefined}
              />
            ),
          )}
        </VStack>
      </SettingsCard>
      <SettingsCard
        title="Model callers without traces"
        hint="Principals seen calling a model in Security Lake in the last 30 days that send no traces."
      >
        <VStack align="stretch" padding={4}>
          <UnlessReadFailed
            error={callers.error}
            fallbackTitle="Couldn't load the model callers"
            onRetry={() => void callers.refetch()}
          >
            {sources === undefined || callers.isLoading ? (
              <Spinner />
            ) : (
              <SecurityLakeCallersList
                hasSource={hasSource}
                callers={callers.data?.callers ?? []}
              />
            )}
          </UnlessReadFailed>
        </VStack>
      </SettingsCard>
    </VStack>
  );
}

/** A failed read says so, rather than showing what it would show for an empty answer. */
function UnlessReadFailed({
  error,
  fallbackTitle,
  onRetry,
  children,
}: {
  error: unknown;
  fallbackTitle: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (!error) return <>{children}</>;
  return <HandledErrorAlert error={error} fallbackTitle={fallbackTitle} onRetry={onRetry} />;
}

/** The edit form of a saved source, with the external id from the admin-only Security Lake read. */
function LakeSourceEdit({
  organizationId,
  lake,
  ...form
}: {
  organizationId: string;
  lake: LakeSource;
  isSaving: boolean;
  isTesting: boolean;
  testResult: SecurityLakeConnectionTest | null | undefined;
  onCancel: () => void;
  onTestConnection: (values: SecurityLakeFormValues) => void;
  onSubmit: (values: SecurityLakeFormValues) => void;
}) {
  const source = api.ingestionSources.securityLakeGet.useQuery({ organizationId, id: lake.id });
  return (
    <SecurityLakeSourceForm
      {...form}
      initialValues={securityLakeFormFromSource(lake)}
      isNew={false}
      externalId={source.data?.externalId}
    />
  );
}

function LakeSourceHealth({
  organizationId,
  lake,
  onEdit,
}: {
  organizationId: string;
  lake: LakeSource;
  onEdit?: () => void;
}) {
  const health = api.ingestionSources.securityLakeHealth.useQuery({ organizationId, id: lake.id });
  return (
    <VStack align="stretch" gap={3}>
      <HStack justify="space-between">
        <strong>{lake.name}</strong>
        {onEdit && (
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
        )}
      </HStack>
      <UnlessReadFailed
        error={health.error}
        fallbackTitle="Couldn't load this source's health"
        onRetry={() => void health.refetch()}
      >
        {health.data ? <SecurityLakeHealthPanel health={health.data} /> : <Spinner size="sm" />}
      </UnlessReadFailed>
    </VStack>
  );
}
