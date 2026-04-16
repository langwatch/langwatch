import {
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

interface AdminOrgFeature {
  id: string;
  feature: string;
  organizationId: string;
  trialEndDate: string | null;
  createdAt: string;
  organization?: { id: string; name: string; slug: string };
}

interface OrgOption {
  id: string;
  name: string;
  slug: string;
}

const PAGE_SIZE = 25;

export default function OrganizationFeaturesView() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [editing, setEditing] = useState<AdminOrgFeature | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useAdminList<AdminOrgFeature>("organizationFeature", {
    pagination: { page, perPage: PAGE_SIZE },
    sort: { field: "createdAt", order: "DESC" },
    filter: debouncedSearch ? { query: debouncedSearch } : {},
  });

  // The server's defaultHandler for organizationFeature getList doesn't
  // include the organization relation, so rows arrive with a raw
  // organizationId only. Resolve names client-side by fetching the org
  // directory (first page of 200 is plenty for the small admin-facing
  // tenant count) and mapping id → name. Rows whose org isn't in the
  // map gracefully fall back to the raw ID.
  const orgDirectory = useAdminList<OrgOption>("organization", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "name", order: "ASC" },
    filter: {},
  });
  const orgNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of orgDirectory.data?.data ?? []) map.set(org.id, org.name);
    return map;
  }, [orgDirectory.data]);

  return (
    <>
      <BackofficeTable
        title="Organization Features"
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search features"
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
        createLabel="Grant feature"
      >
        <Table.Root variant="line" size="md" width="full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Feature</Table.ColumnHeader>
              <Table.ColumnHeader>Organization</Table.ColumnHeader>
              <Table.ColumnHeader>Trial ends</Table.ColumnHeader>
              <Table.ColumnHeader>Created</Table.ColumnHeader>
              <Table.ColumnHeader width="100px" textAlign="right">
                Actions
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.data?.data.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={5}>
                  <Text color="fg.muted" textAlign="center" paddingY={6}>
                    No organization features yet.
                  </Text>
                </Table.Cell>
              </Table.Row>
            )}
            {list.data?.data.map((item) => {
              const orgName =
                item.organization?.name ?? orgNameById.get(item.organizationId);
              return (
              <Table.Row key={item.id}>
                <Table.Cell>{item.feature}</Table.Cell>
                <Table.Cell>
                  {orgName ?? (
                    <Text fontSize="xs" color="fg.muted">
                      {item.organizationId}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {item.trialEndDate ? (
                    formatDate(item.trialEndDate)
                  ) : (
                    <EmptyCell>Permanent</EmptyCell>
                  )}
                </Table.Cell>
                <Table.Cell>{formatDate(item.createdAt)}</Table.Cell>
                <Table.Cell textAlign="right">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setEditing(item)}
                  >
                    <Pencil size={14} /> Edit
                  </Button>
                </Table.Cell>
              </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      </BackofficeTable>

      <OrgFeatureDrawer
        mode="edit"
        item={editing}
        onClose={() => setEditing(null)}
      />
      <OrgFeatureDrawer
        mode="create"
        item={creating ? null : undefined}
        onClose={() => setCreating(false)}
      />
    </>
  );
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function OrgFeatureDrawer({
  mode,
  item,
  onClose,
}: {
  mode: "create" | "edit";
  item: AdminOrgFeature | null | undefined;
  onClose: () => void;
}) {
  const update = useAdminUpdate<AdminOrgFeature>("organizationFeature");
  const create = useAdminCreate<AdminOrgFeature>("organizationFeature");
  const mutation = mode === "edit" ? update : create;

  const [feature, setFeature] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [trialEndDate, setTrialEndDate] = useState("");
  const [orgQuery, setOrgQuery] = useState("");
  const [debouncedOrgQuery] = useDebounce(orgQuery, 250);

  const isOpen = mode === "edit" ? !!item : item !== undefined;

  useEffect(() => {
    if (!isOpen) return;
    if (mode === "edit" && item) {
      setFeature(item.feature);
      setOrganizationId(item.organizationId);
      setTrialEndDate(toDateInputValue(item.trialEndDate));
    } else if (mode === "create") {
      setFeature("");
      setOrganizationId("");
      setTrialEndDate("");
      setOrgQuery("");
    }
  }, [isOpen, mode, item]);

  const orgList = useAdminList<OrgOption>(
    "organization",
    {
      pagination: { page: 1, perPage: 50 },
      sort: { field: "name", order: "ASC" },
      filter: debouncedOrgQuery ? { query: debouncedOrgQuery } : {},
    },
    { enabled: isOpen },
  );

  const orgOptions = useMemo(() => orgList.data?.data ?? [], [orgList.data]);

  const handleSave = () => {
    if (!feature.trim()) {
      toaster.create({
        title: "Feature is required",
        type: "error",
        duration: 3000,
        meta: { closable: true },
      });
      return;
    }
    if (!organizationId) {
      toaster.create({
        title: "Organization is required",
        type: "error",
        duration: 3000,
        meta: { closable: true },
      });
      return;
    }
    const payload: Record<string, unknown> = {
      feature: feature.trim(),
      organizationId,
      trialEndDate: dateInputToISO(trialEndDate),
    };
    const onSuccess = () => {
      toaster.create({
        title:
          mode === "edit"
            ? "Feature updated"
            : "Feature granted",
        type: "success",
        duration: 3000,
        meta: { closable: true },
      });
      onClose();
    };
    const onError = (err: Error) =>
      toaster.create({
        title: mode === "edit" ? "Update failed" : "Grant failed",
        description: err.message,
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });

    if (mode === "edit" && item) {
      update.mutate({ id: item.id, data: payload }, { onSuccess, onError });
    } else {
      create.mutate(payload, { onSuccess, onError });
    }
  };

  const title = mode === "edit" ? "Edit Organization Feature" : "Grant Feature";

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
            <Field.Root required>
              <Field.Label>Feature</Field.Label>
              <Input
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
                placeholder="e.g. CUSTOM_EMBEDDINGS"
              />
              <Field.HelperText>
                Free-form feature key consumed by the entitlement checker.
              </Field.HelperText>
            </Field.Root>
            <Field.Root required>
              <Field.Label>Organization</Field.Label>
              {mode === "edit" && item?.organization?.name && !orgQuery && (
                <Text fontSize="xs" color="fg.muted">
                  Currently: {item.organization.name}
                </Text>
              )}
              <Input
                placeholder="Type to search organizations"
                value={orgQuery}
                onChange={(e) => setOrgQuery(e.target.value)}
              />
              <NativeSelect.Root size="sm" width="full" mt={1}>
                <NativeSelect.Field
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                >
                  <option value="">Select organization…</option>
                  {orgOptions.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.slug})
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
            <Field.Root>
              <Field.Label>Trial end date</Field.Label>
              <Input
                type="date"
                value={trialEndDate}
                onChange={(e) => setTrialEndDate(e.target.value)}
              />
              <Field.HelperText>
                Leave empty to grant the feature permanently.
              </Field.HelperText>
            </Field.Root>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={mutation.isPending} onClick={handleSave}>
              {mode === "edit" ? "Save" : "Grant"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
