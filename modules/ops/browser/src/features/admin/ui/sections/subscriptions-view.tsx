import { Drawer } from "@langwatch/design-system/drawer";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Badge,
  Box,
  Field,
  Heading,
  HStack,
  Input,
  NativeSelect,
  SimpleGrid,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Temporal, toEpochMs } from "@langwatch/time";
import { MoreVertical, Pencil, SearchX } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useDebounce } from "use-debounce";

import { useOpsToaster, useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
import { useAdminCreate, useAdminList, useAdminUpdate } from "../../behavior/use-admin-resource.ts";
import { PlanTypes, SubscriptionStatus } from "../../model/admin-enums.ts";
import { AdminDate, EmptyCell, dateInputToISO, formatDate } from "../elements/admin-cells.tsx";
import { AdminTable } from "./admin-table-shell.tsx";

/** The controls a failed submit can land on; wrappers that carry the state are skipped. */
const INVALID_CONTROL =
  'input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"]';
interface AdminSubscription {
  id: string;
  organizationId: string;
  plan: PlanTypes;
  status: SubscriptionStatus;
  stripeSubscriptionId: string | null;
  startDate: string | null;
  endDate: string | null;
  lastPaymentFailedDate: string | null;
  maxMembers: number | null;
  maxMembersLite: number | null;
  maxTeams: number | null;
  maxProjects: number | null;
  maxWorkflows: number | null;
  maxPrompts: number | null;
  maxAgents: number | null;
  maxScenarios: number | null;
  maxEvaluators: number | null;
  maxExperiments: number | null;
  maxOnlineEvaluations: number | null;
  maxMessagesPerMonth: number | null;
  maxRetentionDays: number | null;
  maxDatasets: number | null;
  maxDashboards: number | null;
  maxCustomGraphs: number | null;
  maxAutomations: number | null;
  organization?: { id: string; name: string; slug: string };
  createdAt: string;
}

const PAGE_SIZE = 25;

const statusColor: Record<SubscriptionStatus, string> = {
  ACTIVE: "green",
  PENDING: "yellow",
  FAILED: "red",
  CANCELLED: "gray",
};

/**
 * Every numeric limit the server stores on a subscription, rendered as its own
 * form field. Kept as a table so adding/removing a limit is a one-line change.
 */
const LIMIT_FIELDS: {
  key: keyof AdminSubscription;
  label: string;
  group: "Members" | "Resources" | "Evaluation" | "Observability" | "Analytics";
}[] = [
  { key: "maxMembers", label: "Max members", group: "Members" },
  { key: "maxMembersLite", label: "Max lite members", group: "Members" },
  { key: "maxTeams", label: "Max teams", group: "Members" },

  { key: "maxProjects", label: "Max projects", group: "Resources" },
  { key: "maxWorkflows", label: "Max workflows", group: "Resources" },
  { key: "maxPrompts", label: "Max prompts", group: "Resources" },
  { key: "maxAgents", label: "Max agents", group: "Resources" },
  { key: "maxScenarios", label: "Max scenarios", group: "Resources" },

  { key: "maxEvaluators", label: "Max evaluators", group: "Evaluation" },
  { key: "maxExperiments", label: "Max experiments", group: "Evaluation" },
  {
    key: "maxOnlineEvaluations",
    label: "Max online evaluations",
    group: "Evaluation",
  },
  {
    key: "maxMessagesPerMonth",
    label: "Max traces per month",
    group: "Observability",
  },
  {
    key: "maxRetentionDays",
    label: "Max retention days",
    group: "Observability",
  },
  { key: "maxDatasets", label: "Max datasets", group: "Observability" },

  { key: "maxDashboards", label: "Max dashboards", group: "Analytics" },
  { key: "maxCustomGraphs", label: "Max custom graphs", group: "Analytics" },
  { key: "maxAutomations", label: "Max automations", group: "Analytics" },
];

export default function SubscriptionsView() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [editing, setEditing] = useState<AdminSubscription | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useAdminList<AdminSubscription>("subscription", {
    pagination: { page, perPage: PAGE_SIZE },
    sort: { field: "createdAt", order: "DESC" },
    filter: debouncedSearch ? { query: debouncedSearch } : {},
  });

  return (
    <>
      <AdminTable
        title="Subscriptions"
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by ID, Stripe ID, org, plan, or status"
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        pagination={{
          page,
          perPage: PAGE_SIZE,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        onCreate={() => setCreating(true)}
        createLabel="New subscription"
      >
        <ListTable density="compact" scroll="x" scrollLabel="Subscriptions table">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Organization</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Plan</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Stripe ID</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Start</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>End</ListTable.ColumnHeader>
              <ListTable.ColumnHeader width={60} align="end" label="Actions" />
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {list.data?.data.length === 0 && (
              <ListTable.SpanRow columns={7}>
                <NoDataInfoBlock
                  icon={<SearchX />}
                  title="No subscriptions match your search."
                  description="Try a different search or clear the filter to see all records."
                />
              </ListTable.SpanRow>
            )}
            {list.data?.data.map((sub) => (
              <ListTable.Row key={sub.id}>
                <ListTable.Cell>
                  {sub.organization?.name ?? (
                    <Text fontSize="xs" color="fg.muted">
                      {sub.organizationId}
                    </Text>
                  )}
                </ListTable.Cell>
                <ListTable.Cell>
                  <Badge size="sm" variant="subtle">
                    {sub.plan}
                  </Badge>
                </ListTable.Cell>
                <ListTable.Cell>
                  <Badge size="sm" colorPalette={statusColor[sub.status]}>
                    {sub.status}
                  </Badge>
                </ListTable.Cell>
                <ListTable.Cell>{sub.stripeSubscriptionId ?? <EmptyCell />}</ListTable.Cell>
                <ListTable.Cell>
                  <AdminDate value={sub.startDate} display="date" />
                </ListTable.Cell>
                <ListTable.Cell>
                  <AdminDate value={sub.endDate} display="date" />
                </ListTable.Cell>
                <ListTable.Cell align="end">
                  <Box width="full" height="full" display="flex" justifyContent="end">
                    <Menu.Root>
                      <Menu.Trigger>
                        <MoreVertical size={16} />
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item value="edit" onClick={() => setEditing(sub)}>
                          <Pencil size={16} />
                          Edit
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Root>
                  </Box>
                </ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
      </AdminTable>

      <SubscriptionDrawer mode="edit" subscription={editing} onClose={() => setEditing(null)} />
      <SubscriptionDrawer
        mode="create"
        subscription={creating ? null : undefined}
        onClose={() => setCreating(false)}
      />
    </>
  );
}

type LimitKey =
  | "maxMembers"
  | "maxMembersLite"
  | "maxTeams"
  | "maxProjects"
  | "maxWorkflows"
  | "maxPrompts"
  | "maxAgents"
  | "maxScenarios"
  | "maxEvaluators"
  | "maxExperiments"
  | "maxOnlineEvaluations"
  | "maxMessagesPerMonth"
  | "maxRetentionDays"
  | "maxDatasets"
  | "maxDashboards"
  | "maxCustomGraphs"
  | "maxAutomations";

type FormState = {
  organizationId: string;
  plan: PlanTypes;
  status: SubscriptionStatus;
  stripeSubscriptionId: string;
  startDate: string;
  endDate: string;
} & Record<LimitKey, string>;

const EMPTY_LIMITS: Record<LimitKey, string> = LIMIT_FIELDS.reduce(
  (acc, f) => {
    acc[f.key as LimitKey] = "";
    return acc;
  },
  {} as Record<LimitKey, string>,
);

const EMPTY_FORM: FormState = {
  organizationId: "",
  plan: "FREE",
  status: "PENDING",
  stripeSubscriptionId: "",
  startDate: "",
  endDate: "",
  ...EMPTY_LIMITS,
};

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const epochMs = toEpochMs(value);
  if (Number.isNaN(epochMs)) return "";
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toString().slice(0, 10);
}

function numOrNull(raw: string): number | null {
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function SubscriptionDrawer({
  mode,
  subscription,
  onClose,
}: {
  mode: "create" | "edit";
  subscription: AdminSubscription | null | undefined;
  onClose: () => void;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const update = useAdminUpdate<AdminSubscription>("subscription");
  const create = useAdminCreate<AdminSubscription>("subscription");
  const mutation = mode === "edit" ? update : create;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [attempts, setAttempts] = useState(0);
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const isOpen = mode === "edit" ? !!subscription : subscription !== undefined;

  useEffect(() => {
    if (!isOpen) return;
    setAttempts(0);
    if (mode === "edit" && subscription) {
      setForm(formFromSubscription(subscription));
    } else if (mode === "create") {
      setForm(EMPTY_FORM);
    }
  }, [isOpen, mode, subscription]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const copy = DRAWER_COPY[mode];
  const title = copy.title;

  useEffect(() => {
    if (attempts === 0) return;
    formRef.current?.querySelector<HTMLElement>(INVALID_CONTROL)?.focus();
  }, [attempts]);

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    if (!form.organizationId) {
      setAttempts((count) => count + 1);
      return;
    }
    const payload = payloadFromForm(form);

    const onSuccess = () => {
      toaster.create({
        title: copy.saved,
        type: "success",
        duration: 3000,
      });
      onClose();
    };
    const onError = (err: Error) =>
      showErrorToast({
        error: err,
        fallbackTitle: copy.failed,
      });

    if (mode === "edit" && subscription) {
      update.mutate({ id: subscription.id, data: payload }, { onSuccess, onError });
    } else {
      create.mutate(payload, { onSuccess, onError });
    }
  };

  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      title={title}
      size="lg"
      footer={{
        cancel: { onClick: onClose },
        primaryAction: {
          label: mode === "edit" ? "Save" : "Create",
          type: "submit",
          form: formId,
          loading: mutation.isPending,
        },
      }}
    >
      <form id={formId} ref={formRef} noValidate onSubmit={handleSave}>
        <VStack gap={4} align="stretch">
          <SectionHeading>Subscription</SectionHeading>
          <OrganizationPicker
            value={form.organizationId}
            onChange={(id) => setField("organizationId", id)}
            currentName={subscription?.organization?.name}
            invalid={attempts > 0 && !form.organizationId}
          />
          <HStack gap={3} align="start">
            <Field.Root>
              <Field.Label>Plan</Field.Label>
              <EnumSelect
                value={form.plan}
                options={Object.values(PlanTypes)}
                onChange={(v) => setField("plan", v as PlanTypes)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Status</Field.Label>
              <EnumSelect
                value={form.status}
                options={Object.values(SubscriptionStatus)}
                onChange={(v) => setField("status", v as SubscriptionStatus)}
              />
            </Field.Root>
          </HStack>
          <Field.Root>
            <Field.Label>Stripe subscription ID</Field.Label>
            <Input
              value={form.stripeSubscriptionId}
              onChange={(e) => setField("stripeSubscriptionId", e.target.value)}
            />
          </Field.Root>
          <HStack gap={3}>
            <Field.Root>
              <Field.Label>Start date</Field.Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setField("startDate", e.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>End date</Field.Label>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => setField("endDate", e.target.value)}
              />
            </Field.Root>
          </HStack>

          {GROUPED_LIMITS.map(([group, fields]) => (
            <VStack key={group} gap={3} align="stretch">
              <SectionHeading>{group} limits</SectionHeading>
              <SimpleGrid columns={2} gap={3}>
                {fields.map((f) => (
                  <Field.Root key={f.key}>
                    <Field.Label>{f.label}</Field.Label>
                    <Input
                      type="number"
                      value={form[f.key as LimitKey]}
                      onChange={(e) => setField(f.key as LimitKey, e.target.value)}
                      placeholder="—"
                    />
                  </Field.Root>
                ))}
              </SimpleGrid>
            </VStack>
          ))}

          {mode === "edit" && subscription && (
            <VStack align="start" gap={0} pt={2}>
              <Text fontSize="xs" color="fg.muted">
                Subscription ID: {subscription.id}
              </Text>
              {subscription.lastPaymentFailedDate && (
                <Text fontSize="xs" color="fg.error">
                  Last payment failed: {formatDate(subscription.lastPaymentFailedDate)}
                </Text>
              )}
            </VStack>
          )}
        </VStack>
      </form>
    </Drawer>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading as="h3" size="xs" color="fg.muted" textTransform="none" letterSpacing="wider" pt={2}>
      {children}
    </Heading>
  );
}

function EnumSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect.Root size="sm" width="full">
      <NativeSelect.Field value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

interface OrgOption {
  id: string;
  name: string;
  slug: string;
}

/**
 * Simple organization picker for the Subscription form: fetches the first page
 * by query (or first 50 if empty) and lets the operator pick, with
 * autocomplete as they type.
 */
function OrganizationPicker({
  value,
  onChange,
  currentName,
  invalid,
}: {
  value: string;
  onChange: (id: string) => void;
  currentName?: string;
  invalid: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, 250);

  const list = useAdminList<OrgOption>("organization", {
    pagination: { page: 1, perPage: 50 },
    sort: { field: "name", order: "ASC" },
    filter: debouncedQuery ? { query: debouncedQuery } : {},
  });

  const options = list.data?.data ?? [];

  return (
    <Field.Root required invalid={invalid}>
      <Field.Label>Organization</Field.Label>
      {value && !query && currentName && (
        <Text fontSize="xs" color="fg.muted">
          Currently: {currentName}
        </Text>
      )}
      <Input
        placeholder="Type to search organizations"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-invalid={invalid || undefined}
      />
      <NativeSelect.Root size="sm" width="full" mt={1}>
        <NativeSelect.Field value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select organization…</option>
          {options.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name} ({org.slug})
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <Field.ErrorText>Choose an organization.</Field.ErrorText>
    </Field.Root>
  );
}

const DRAWER_COPY = {
  edit: {
    title: "Edit Subscription",
    saved: "Subscription updated",
    failed: "Couldn't update the subscription",
  },
  create: {
    title: "New Subscription",
    saved: "Subscription created",
    failed: "Couldn't create the subscription",
  },
} as const;

/** The edit form, filled from a stored subscription. */
function formFromSubscription(subscription: AdminSubscription): FormState {
  const limitValues = LIMIT_FIELDS.reduce(
    (acc, f) => {
      const raw = subscription[f.key];
      acc[f.key as LimitKey] = typeof raw === "number" ? raw.toString() : "";
      return acc;
    },
    {} as Record<LimitKey, string>,
  );
  return {
    organizationId: subscription.organizationId,
    plan: subscription.plan,
    status: subscription.status,
    stripeSubscriptionId: subscription.stripeSubscriptionId ?? "",
    startDate: toDateInputValue(subscription.startDate),
    endDate: toDateInputValue(subscription.endDate),
    ...limitValues,
  };
}

/** What the admin write receives for this form. */
function payloadFromForm(form: FormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    organizationId: form.organizationId,
    plan: form.plan,
    status: form.status,
    stripeSubscriptionId: form.stripeSubscriptionId || null,
    startDate: dateInputToISO(form.startDate),
    endDate: dateInputToISO(form.endDate),
  };
  for (const f of LIMIT_FIELDS) {
    payload[f.key] = numOrNull(form[f.key as LimitKey]);
  }
  return payload;
}

/** Limit fields grouped by their "group" tag so the form renders tight sections. */
const GROUPED_LIMITS = (() => {
  const map = new Map<string, typeof LIMIT_FIELDS>();
  for (const f of LIMIT_FIELDS) {
    const bucket = map.get(f.group) ?? [];
    bucket.push(f);
    map.set(f.group, bucket);
  }
  return Array.from(map.entries());
})();
