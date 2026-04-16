import {
  Badge,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
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
} from "~/components/ops/backoffice/BackofficeTable";
import {
  useAdminCreate,
  useAdminList,
  useAdminUpdate,
} from "~/components/ops/backoffice/useAdminResource";

interface AdminSubscription {
  id: string;
  organizationId: string;
  plan: PlanTypes;
  status: SubscriptionStatus;
  stripeSubscriptionId: string | null;
  startDate: string | null;
  endDate: string | null;
  maxMembers: number | null;
  maxProjects: number | null;
  maxMessagesPerMonth: number | null;
  evaluationsCredit: number | null;
  maxWorkflows: number | null;
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
        searchPlaceholder="Search by Stripe ID, org, plan, or status"
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

interface FormState {
  organizationId: string;
  plan: PlanTypes;
  status: SubscriptionStatus;
  stripeSubscriptionId: string;
  startDate: string; // yyyy-MM-dd
  endDate: string;
  maxMembers: string;
  maxProjects: string;
  maxMessagesPerMonth: string;
  evaluationsCredit: string;
  maxWorkflows: string;
}

const EMPTY_FORM: FormState = {
  organizationId: "",
  plan: "FREE",
  status: "PENDING",
  stripeSubscriptionId: "",
  startDate: "",
  endDate: "",
  maxMembers: "",
  maxProjects: "",
  maxMessagesPerMonth: "",
  evaluationsCredit: "",
  maxWorkflows: "",
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
  /** edit: subscription to edit. create: null means open, undefined means closed. */
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
      setForm({
        organizationId: subscription.organizationId,
        plan: subscription.plan,
        status: subscription.status,
        stripeSubscriptionId: subscription.stripeSubscriptionId ?? "",
        startDate: toDateInputValue(subscription.startDate),
        endDate: toDateInputValue(subscription.endDate),
        maxMembers: subscription.maxMembers?.toString() ?? "",
        maxProjects: subscription.maxProjects?.toString() ?? "",
        maxMessagesPerMonth:
          subscription.maxMessagesPerMonth?.toString() ?? "",
        evaluationsCredit: subscription.evaluationsCredit?.toString() ?? "",
        maxWorkflows: subscription.maxWorkflows?.toString() ?? "",
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
      maxMembers: numOrNull(form.maxMembers),
      maxProjects: numOrNull(form.maxProjects),
      maxMessagesPerMonth: numOrNull(form.maxMessagesPerMonth),
      evaluationsCredit: numOrNull(form.evaluationsCredit),
      maxWorkflows: numOrNull(form.maxWorkflows),
    };

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

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{title}</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          <VStack gap={4} align="stretch">
            <OrganizationPicker
              value={form.organizationId}
              onChange={(id) => setField("organizationId", id)}
              currentName={subscription?.organization?.name}
            />
            <Field.Root>
              <Field.Label>Plan</Field.Label>
              <NativeSelect.Root size="sm" width="full">
                <NativeSelect.Field
                  value={form.plan}
                  onChange={(e) =>
                    setField("plan", e.target.value as PlanTypes)
                  }
                >
                  {Object.values(PlanTypes).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
            <Field.Root>
              <Field.Label>Status</Field.Label>
              <NativeSelect.Root size="sm" width="full">
                <NativeSelect.Field
                  value={form.status}
                  onChange={(e) =>
                    setField("status", e.target.value as SubscriptionStatus)
                  }
                >
                  {Object.values(SubscriptionStatus).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
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
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted" pt={2}>
              Limits
            </Text>
            <HStack gap={3}>
              <NumberField
                label="Max members"
                value={form.maxMembers}
                onChange={(v) => setField("maxMembers", v)}
              />
              <NumberField
                label="Max projects"
                value={form.maxProjects}
                onChange={(v) => setField("maxProjects", v)}
              />
            </HStack>
            <HStack gap={3}>
              <NumberField
                label="Max traces per month"
                value={form.maxMessagesPerMonth}
                onChange={(v) => setField("maxMessagesPerMonth", v)}
              />
              <NumberField
                label="Evaluations credit"
                value={form.evaluationsCredit}
                onChange={(v) => setField("evaluationsCredit", v)}
              />
            </HStack>
            <HStack gap={3}>
              <NumberField
                label="Max workflows"
                value={form.maxWorkflows}
                onChange={(v) => setField("maxWorkflows", v)}
              />
              <Spacer />
            </HStack>
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

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field.Root>
      <Field.Label>{label}</Field.Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field.Root>
  );
}

interface OrgOption {
  id: string;
  name: string;
  slug: string;
}

/**
 * Simple organization picker — fetches the first page by query (or first 100
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
