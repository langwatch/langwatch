import {
  Badge,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  NativeSelect,
  SimpleGrid,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { PlanTypes, SubscriptionStatus } from "@prisma/client";
import { Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import {
  BackofficeTable,
  EmptyCell,
  dateInputToISO,
  formatDate,
} from "../BackofficeTable";
import {
  useAdminCreate,
  useAdminList,
  useAdminUpdate,
} from "../useAdminResource";

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
  evaluationsCredit: number | null;
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
const LIMIT_FIELDS: Array<{
  key: keyof AdminSubscription;
  label: string;
  group: "Members" | "Resources" | "Evaluation" | "Observability" | "Analytics";
}> = [
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
  { key: "evaluationsCredit", label: "Evaluations credit", group: "Evaluation" },

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
      <BackofficeTable
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
        <Table.Root variant="line" size="md" width="full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Organization</Table.ColumnHeader>
              <Table.ColumnHeader>Plan</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader>Stripe ID</Table.ColumnHeader>
              <Table.ColumnHeader>Start</Table.ColumnHeader>
              <Table.ColumnHeader>End</Table.ColumnHeader>
              <Table.ColumnHeader width="100px" textAlign="right">
                Actions
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.data?.data.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={7}>
                  <Text color="fg.muted" textAlign="center" paddingY={6}>
                    No subscriptions match your search.
                  </Text>
                </Table.Cell>
              </Table.Row>
            )}
            {list.data?.data.map((sub) => (
              <Table.Row key={sub.id}>
                <Table.Cell>
                  {sub.organization?.name ?? (
                    <Text fontSize="xs" color="fg.muted">
                      {sub.organizationId}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Badge size="sm" variant="subtle">
                    {sub.plan}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Badge size="sm" colorPalette={statusColor[sub.status]}>
                    {sub.status}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  {sub.stripeSubscriptionId ?? <EmptyCell />}
                </Table.Cell>
                <Table.Cell>{formatDate(sub.startDate)}</Table.Cell>
                <Table.Cell>{formatDate(sub.endDate)}</Table.Cell>
                <Table.Cell textAlign="right">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setEditing(sub)}
                  >
                    <Pencil size={14} /> Edit
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </BackofficeTable>

      <SubscriptionDrawer
        mode="edit"
        subscription={editing}
        onClose={() => setEditing(null)}
      />
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
  | "evaluationsCredit"
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
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
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
  const update = useAdminUpdate<AdminSubscription>("subscription");
  const create = useAdminCreate<AdminSubscription>("subscription");
  const mutation = mode === "edit" ? update : create;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const isOpen =
    mode === "edit" ? !!subscription : subscription !== undefined;

  useEffect(() => {
    if (!isOpen) return;
    if (mode === "edit" && subscription) {
      const limitValues = LIMIT_FIELDS.reduce(
        (acc, f) => {
          const raw = subscription[f.key];
          acc[f.key as LimitKey] =
            typeof raw === "number" ? raw.toString() : "";
          return acc;
        },
        {} as Record<LimitKey, string>,
      );
      setForm({
        organizationId: subscription.organizationId,
        plan: subscription.plan,
        status: subscription.status,
        stripeSubscriptionId: subscription.stripeSubscriptionId ?? "",
        startDate: toDateInputValue(subscription.startDate),
        endDate: toDateInputValue(subscription.endDate),
        ...limitValues,
      });
    } else if (mode === "create") {
      setForm(EMPTY_FORM);
    }
  }, [isOpen, mode, subscription]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const title = mode === "edit" ? "Edit Subscription" : "New Subscription";

  const handleSave = () => {
    if (!form.organizationId) {
      toaster.create({
        title: "Organization is required",
        type: "error",
        duration: 3000,
        meta: { closable: true },
      });
      return;
    }
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

    const onSuccess = () => {
      toaster.create({
        title: mode === "edit" ? "Subscription updated" : "Subscription created",
        type: "success",
        duration: 3000,
        meta: { closable: true },
      });
      onClose();
    };
    const onError = (err: Error) =>
      toaster.create({
        title: mode === "edit" ? "Update failed" : "Create failed",
        description: err.message,
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });

    if (mode === "edit" && subscription) {
      update.mutate({ id: subscription.id, data: payload }, { onSuccess, onError });
    } else {
      create.mutate(payload, { onSuccess, onError });
    }
  };

  // Group limit fields by the "group" tag so the form renders tight sections.
  const groupedLimits = useMemo(() => {
    const map = new Map<string, typeof LIMIT_FIELDS>();
    for (const f of LIMIT_FIELDS) {
      const bucket = map.get(f.group) ?? [];
      bucket.push(f);
      map.set(f.group, bucket);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="lg"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{title}</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          <VStack gap={4} align="stretch">
            <SectionHeading>Subscription</SectionHeading>
            <OrganizationPicker
              value={form.organizationId}
              onChange={(id) => setField("organizationId", id)}
              currentName={subscription?.organization?.name}
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
                  onChange={(v) =>
                    setField("status", v as SubscriptionStatus)
                  }
                />
              </Field.Root>
            </HStack>
            <Field.Root>
              <Field.Label>Stripe subscription ID</Field.Label>
              <Input
                value={form.stripeSubscriptionId}
                onChange={(e) =>
                  setField("stripeSubscriptionId", e.target.value)
                }
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

            {groupedLimits.map(([group, fields]) => (
              <VStack key={group} gap={3} align="stretch">
                <SectionHeading>{group} limits</SectionHeading>
                <SimpleGrid columns={2} gap={3}>
                  {fields.map((f) => (
                    <Field.Root key={f.key}>
                      <Field.Label>{f.label}</Field.Label>
                      <Input
                        type="number"
                        value={form[f.key as LimitKey]}
                        onChange={(e) =>
                          setField(f.key as LimitKey, e.target.value)
                        }
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
                  <Text fontSize="xs" color="red.500">
                    Last payment failed:{" "}
                    {formatDate(subscription.lastPaymentFailedDate)}
                  </Text>
                )}
              </VStack>
            )}
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={mutation.isPending} onClick={handleSave}>
              {mode === "edit" ? "Save" : "Create"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading
      as="h3"
      size="xs"
      color="fg.muted"
      textTransform="uppercase"
      letterSpacing="wider"
      pt={2}
    >
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
      <NativeSelect.Field
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
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
 * Simple organization picker — fetches the first page by query (or first 50
 * if empty) and lets the operator pick. Mirrors react-admin's AutocompleteInput
 * behaviour for the Subscription form.
 */
function OrganizationPicker({
  value,
  onChange,
  currentName,
}: {
  value: string;
  onChange: (id: string) => void;
  currentName?: string;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, 250);

  const list = useAdminList<OrgOption>("organization", {
    pagination: { page: 1, perPage: 50 },
    sort: { field: "name", order: "ASC" },
    filter: debouncedQuery ? { query: debouncedQuery } : {},
  });

  const options = useMemo(() => list.data?.data ?? [], [list.data]);

  return (
    <Field.Root required>
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
      />
      <NativeSelect.Root size="sm" width="full" mt={1}>
        <NativeSelect.Field
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select organization…</option>
          {options.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name} ({org.slug})
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Field.Root>
  );
}
