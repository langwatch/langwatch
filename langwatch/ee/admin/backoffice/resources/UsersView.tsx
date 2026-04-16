import {
  Badge,
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Table,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Pencil, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { Dialog } from "~/components/ui/dialog";
import { Drawer } from "~/components/ui/drawer";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import {
  BackofficeTable,
  EmptyCell,
  formatDate,
  formatDateTime,
} from "../BackofficeTable";
import { impersonateUser } from "../adminClient";
import {
  useAdminList,
  useAdminUpdate,
} from "../useAdminResource";

interface OrgMembership {
  organization: { id: string; name: string };
}
interface TeamMembership {
  team: { id: string; name: string; projects: { id: string; name: string }[] };
}

interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  emailVerified: boolean;
  pendingSsoSetup: boolean | null;
  createdAt: string;
  lastLoginAt: string | null;
  deactivatedAt: string | null;
  orgMemberships: OrgMembership[];
  teamMemberships: TeamMembership[];
  /** Joined by the server-side mapper for display convenience. */
  organizations?: string;
  projects?: string;
}

const PAGE_SIZE = 25;

export default function UsersView() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const list = useAdminList<AdminUser>("user", {
    pagination: { page, perPage: PAGE_SIZE },
    sort: { field: "createdAt", order: "DESC" },
    filter: debouncedSearch ? { query: debouncedSearch } : {},
  });

  return (
    <>
      <BackofficeTable
        title="Users"
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by ID, name, email, org, or project"
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
              <Table.ColumnHeader>Email</Table.ColumnHeader>
              <Table.ColumnHeader>Organizations</Table.ColumnHeader>
              <Table.ColumnHeader>Projects</Table.ColumnHeader>
              <Table.ColumnHeader>Created</Table.ColumnHeader>
              <Table.ColumnHeader>Last login</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader width="180px" textAlign="right">
                Actions
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.data?.data.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={9}>
                  <Text color="fg.muted" textAlign="center" paddingY={6}>
                    No users match your search.
                  </Text>
                </Table.Cell>
              </Table.Row>
            )}
            {list.data?.data.map((user) => {
              const orgNames =
                user.organizations ??
                user.orgMemberships?.map((m) => m.organization.name).join(", ");
              const projectNames =
                user.projects ??
                user.teamMemberships
                  ?.flatMap((m) => m.team.projects.map((p) => p.name))
                  .join(", ");
              return (
                <Table.Row key={user.id}>
                  <Table.Cell fontSize="xs" color="fg.muted">
                    {user.id}
                  </Table.Cell>
                  <Table.Cell>{user.name ?? <EmptyCell />}</Table.Cell>
                  <Table.Cell>{user.email ?? <EmptyCell />}</Table.Cell>
                  <Table.Cell>
                    {orgNames ? orgNames : <EmptyCell />}
                  </Table.Cell>
                  <Table.Cell>
                    {projectNames ? projectNames : <EmptyCell />}
                  </Table.Cell>
                  <Table.Cell>{formatDate(user.createdAt)}</Table.Cell>
                  <Table.Cell>{formatDateTime(user.lastLoginAt)}</Table.Cell>
                  <Table.Cell>
                    {user.deactivatedAt ? (
                      <Badge colorPalette="red" size="sm">
                        Deactivated
                      </Badge>
                    ) : user.pendingSsoSetup ? (
                      <Badge colorPalette="yellow" size="sm">
                        Pending SSO
                      </Badge>
                    ) : user.emailVerified ? (
                      <Badge colorPalette="green" size="sm">
                        Active
                      </Badge>
                    ) : (
                      <Badge colorPalette="gray" size="sm">
                        Unverified
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell textAlign="right">
                    <HStack gap={1} justify="end">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setEditing(user)}
                      >
                        <Pencil size={14} /> Edit
                      </Button>
                      <ImpersonateButton user={user} />
                    </HStack>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      </BackofficeTable>

      <UserEditDrawer user={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function ImpersonateButton({ user }: { user: AdminUser }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toaster.create({
        title: "Reason is required",
        description: "Saved to the audit log alongside the impersonation.",
        type: "error",
        duration: 3000,
        meta: { closable: true },
      });
      return;
    }
    setLoading(true);
    try {
      await impersonateUser({
        userIdToImpersonate: user.id,
        reason: trimmed,
      });
      window.location.href = "/";
    } catch (err) {
      toaster.create({
        title: "Impersonation failed",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          setReason("");
          setOpen(true);
        }}
      >
        <UserCheck size={14} /> Impersonate
      </Button>
      <Dialog.Root
        open={open}
        onOpenChange={({ open: next }) => {
          if (!next && !loading) setOpen(false);
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Impersonate user</Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger disabled={loading} />
          <Dialog.Body>
            <VStack gap={3} align="stretch">
              <Text fontSize="sm" color="fg.muted">
                You will sign in as{" "}
                <Text as="span" fontWeight="semibold" color="fg">
                  {user.name ?? user.email ?? user.id}
                </Text>
                . The reason below is saved to the audit log.
              </Text>
              <Field.Root required>
                <Field.Label>Reason</Field.Label>
                <Textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Debugging a stuck trace reported by support ticket #…"
                  disabled={loading}
                />
              </Field.Root>
            </VStack>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack width="full">
              <Spacer />
              <Button
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button onClick={submit} loading={loading} colorPalette="orange">
                Impersonate
              </Button>
            </HStack>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

function UserEditDrawer({
  user,
  onClose,
}: {
  user: AdminUser | null;
  onClose: () => void;
}) {
  const update = useAdminUpdate<AdminUser>("user");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [image, setImage] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [pendingSsoSetup, setPendingSsoSetup] = useState(false);
  const [deactivate, setDeactivate] = useState(false);

  // Re-seed the form every time the drawer opens on a different user.
  useEffect(() => {
    if (!user) return;
    setName(user.name ?? "");
    setEmail(user.email ?? "");
    setImage(user.image ?? "");
    setEmailVerified(!!user.emailVerified);
    setPendingSsoSetup(!!user.pendingSsoSetup);
    setDeactivate(!!user.deactivatedAt);
  }, [user]);

  const handleSave = () => {
    if (!user) return;
    const data: Record<string, unknown> = {};
    if (name !== (user.name ?? "")) data.name = name;
    if (email !== (user.email ?? "")) data.email = email;
    if (image !== (user.image ?? "")) data.image = image || null;
    if (emailVerified !== !!user.emailVerified) {
      data.emailVerified = emailVerified;
    }
    if (pendingSsoSetup !== !!user.pendingSsoSetup) {
      data.pendingSsoSetup = pendingSsoSetup;
    }
    const currentlyDeactivated = !!user.deactivatedAt;
    if (deactivate !== currentlyDeactivated) {
      data.deactivatedAt = deactivate ? new Date().toISOString() : null;
    }
    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { id: user.id, data },
      {
        onSuccess: () => {
          toaster.create({
            title: "User updated",
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
      open={!!user}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Edit User</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {user && (
            <VStack gap={4} align="stretch">
              <Field.Root>
                <Field.Label>Name</Field.Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Email</Field.Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Avatar URL</Field.Label>
                <Input
                  type="url"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="https://…"
                />
              </Field.Root>
              <ToggleRow
                label="Email verified"
                hint="Flip manually after an out-of-band verification."
                checked={emailVerified}
                onChange={setEmailVerified}
              />
              <ToggleRow
                label="Pending SSO setup"
                hint="Allows first-time SSO provider linking."
                checked={pendingSsoSetup}
                onChange={setPendingSsoSetup}
              />
              <ToggleRow
                label="Deactivated"
                hint="Revokes sessions + blocks new logins until reactivated."
                checked={deactivate}
                onChange={setDeactivate}
              />
              <VStack align="start" gap={0} pt={2}>
                <Text fontSize="xs" color="fg.muted">
                  User ID: {user.id}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Created: {formatDateTime(user.createdAt)}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Last login: {formatDateTime(user.lastLoginAt)}
                </Text>
              </VStack>
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

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Field.Root>
      <HStack width="full">
        <VStack align="start" gap={0}>
          <Field.Label>{label}</Field.Label>
          <Text fontSize="xs" color="fg.muted">
            {hint}
          </Text>
        </VStack>
        <Spacer />
        <Switch
          checked={checked}
          onCheckedChange={(e) => onChange(e.checked)}
        />
      </HStack>
    </Field.Root>
  );
}
