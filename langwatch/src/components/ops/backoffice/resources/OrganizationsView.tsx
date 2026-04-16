import {
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import {
  BackofficeTable,
  EmptyCell,
  formatDate,
} from "~/components/ops/backoffice/BackofficeTable";
import {
  useAdminList,
  useAdminUpdate,
} from "~/components/ops/backoffice/useAdminResource";

interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  phoneNumber: string | null;
  ssoDomain: string | null;
  ssoProvider: string | null;
  createdAt: string;
}

const PAGE_SIZE = 25;

export default function OrganizationsView() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [editing, setEditing] = useState<AdminOrganization | null>(null);

  const list = useAdminList<AdminOrganization>("organization", {
    pagination: { page, perPage: PAGE_SIZE },
    sort: { field: "createdAt", order: "DESC" },
    filter: debouncedSearch ? { query: debouncedSearch } : {},
  });

  return (
    <>
      <BackofficeTable
        title="Organizations"
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by name or slug"
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        pagination={{
          page,
          perPage: PAGE_SIZE,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
      >
        <Table.Root variant="line" size="md" width="full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>ID</Table.ColumnHeader>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Slug</Table.ColumnHeader>
              <Table.ColumnHeader>SSO domain</Table.ColumnHeader>
              <Table.ColumnHeader>Created</Table.ColumnHeader>
              <Table.ColumnHeader width="100px" textAlign="right">
                Actions
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.data?.data.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={6}>
                  <Text color="fg.muted" textAlign="center" paddingY={6}>
                    No organizations match your search.
                  </Text>
                </Table.Cell>
              </Table.Row>
            )}
            {list.data?.data.map((org) => (
              <Table.Row key={org.id}>
                <Table.Cell fontSize="xs" color="fg.muted">
                  {org.id}
                </Table.Cell>
                <Table.Cell>{org.name}</Table.Cell>
                <Table.Cell>{org.slug}</Table.Cell>
                <Table.Cell>
                  {org.ssoDomain ?? <EmptyCell />}
                </Table.Cell>
                <Table.Cell>{formatDate(org.createdAt)}</Table.Cell>
                <Table.Cell textAlign="right">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setEditing(org)}
                  >
                    <Pencil size={14} /> Edit
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </BackofficeTable>

      <OrganizationEditDrawer
        organization={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function OrganizationEditDrawer({
  organization,
  onClose,
}: {
  organization: AdminOrganization | null;
  onClose: () => void;
}) {
  const update = useAdminUpdate<AdminOrganization>("organization");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [ssoDomain, setSsoDomain] = useState("");
  const [ssoProvider, setSsoProvider] = useState("");

  useEffect(() => {
    if (!organization) return;
    setName(organization.name ?? "");
    setSlug(organization.slug ?? "");
    setPhoneNumber(organization.phoneNumber ?? "");
    setSsoDomain(organization.ssoDomain ?? "");
    setSsoProvider(organization.ssoProvider ?? "");
  }, [organization]);

  const handleSave = () => {
    if (!organization) return;
    const data: Record<string, unknown> = {};
    if (name !== organization.name) data.name = name;
    if (slug !== organization.slug) data.slug = slug;
    if (phoneNumber !== (organization.phoneNumber ?? ""))
      data.phoneNumber = phoneNumber || null;
    if (ssoDomain !== (organization.ssoDomain ?? ""))
      data.ssoDomain = ssoDomain || null;
    if (ssoProvider !== (organization.ssoProvider ?? ""))
      data.ssoProvider = ssoProvider || null;
    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { id: organization.id, data },
      {
        onSuccess: () => {
          toaster.create({
            title: "Organization updated",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          onClose();
        },
        onError: (err) =>
          toaster.create({
            title: "Update failed",
            description: err.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          }),
      },
    );
  };

  return (
    <Drawer.Root
      open={!!organization}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Edit Organization</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {organization && (
            <VStack gap={4} align="stretch">
              <Field.Root>
                <Field.Label>Name</Field.Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Slug</Field.Label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
                <Field.HelperText>
                  URL-safe identifier. Changing this can break existing links.
                </Field.HelperText>
              </Field.Root>
              <Field.Root>
                <Field.Label>Phone number</Field.Label>
                <Input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>SSO domain</Field.Label>
                <Input
                  value={ssoDomain}
                  onChange={(e) => setSsoDomain(e.target.value)}
                  placeholder="e.g. acme.com"
                />
                <Field.HelperText>
                  Lowercased server-side. Users with this email domain can
                  sign in via SSO.
                </Field.HelperText>
              </Field.Root>
              <Field.Root>
                <Field.Label>SSO provider</Field.Label>
                <Input
                  value={ssoProvider}
                  onChange={(e) => setSsoProvider(e.target.value)}
                />
              </Field.Root>
              <Text fontSize="xs" color="fg.muted">
                Organization ID: {organization.id}
              </Text>
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={update.isPending} onClick={handleSave}>
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
