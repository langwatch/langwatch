import {
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Archive, ExternalLink, MoreVertical, Pencil } from "lucide-react";
import { useState } from "react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { DepartmentEditDrawer } from "~/components/settings/DepartmentEditDrawer";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

type Department = RouterOutputs["departments"]["list"][number];

function DepartmentsPage() {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";

  const utils = api.useUtils();
  const listQuery = api.departments.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const refresh = async () => {
    await utils.departments.list.invalidate({ organizationId: orgId });
  };

  const [newName, setNewName] = useState("");
  const createMutation = api.departments.create.useMutation({
    onSuccess: async () => {
      setNewName("");
      toaster.create({ title: "Department created", type: "success" });
      await refresh();
    },
    onError: (e) =>
      toaster.create({ title: "Create failed", description: e.message, type: "error" }),
  });

  const departments = listQuery.data ?? [];
  const hasDepartments = departments.length > 0;

  return (
    <GovernanceLayout pageTitle="Departments · AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <VStack align="start" gap={1}>
          <Text fontSize="xs" color="fg.muted">
            <Link href="/governance" color="blue.600">
              ← AI Governance
            </Link>{" "}
            · Departments
          </Text>
          <Heading size="md">Departments</Heading>
          <Text color="fg.muted" fontSize="sm" maxW="2xl">
            A department is an accounting label for spend. Assign people,
            teams, and projects to one, and spend rolls up by department
            across the org, including personal AI use. Departments never
            grant or restrict access.
          </Text>
        </VStack>

        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          padding={4}
        >
          <Text fontWeight="semibold" fontSize="sm" marginBottom={2}>
            Create a department
          </Text>
          <HStack>
            <Input
              size="sm"
              maxW="sm"
              placeholder="e.g. Engineering, Marketing"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  createMutation.mutate({
                    organizationId: orgId,
                    name: newName.trim(),
                  });
                }
              }}
            />
            <Button
              size="sm"
              colorPalette="orange"
              loading={createMutation.isLoading}
              disabled={!newName.trim()}
              onClick={() =>
                createMutation.mutate({
                  organizationId: orgId,
                  name: newName.trim(),
                })
              }
            >
              Create
            </Button>
          </HStack>
        </Box>

        <DepartmentList
          orgId={orgId}
          departments={departments}
          isLoading={listQuery.isLoading}
          onChanged={refresh}
        />

        {hasDepartments && <AssignmentGuide />}
      </VStack>
    </GovernanceLayout>
  );
}

function AssignmentGuide() {
  return (
    <VStack
      align="stretch"
      gap={0}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      overflow="hidden"
    >
      <Box
        paddingY={2}
        paddingX={3}
        borderBottomWidth="1px"
        borderColor="border.muted"
        backgroundColor="bg.subtle"
      >
        <Text
          fontSize="xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          Assigning departments
        </Text>
        <Text fontSize="xs" color="fg.subtle" marginTop={1}>
          Assign people and teams to a department where you already manage
          them. Spend rolls up by department, including personal AI use.
        </Text>
      </Box>
      <AssignmentLink
        href="/settings/members"
        title="People"
        description="A person's spend, including personal AI use, rolls up to their department. Assign each member from the members page."
      />
      <AssignmentLink
        href="/settings/teams"
        title="Teams"
        description="A team department is the default its members and projects inherit when they have none of their own. Assign each team from the teams page."
      />
      <AssignmentLink
        href="/settings/teams"
        title="Projects"
        description="A project is where an autonomous agent runs. Agent spend with no human principal rolls up to the project's department. Assign each project from the teams page, next to its team."
      />
    </VStack>
  );
}

function AssignmentLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} variant="plain">
      <HStack
        paddingY={3}
        paddingX={3}
        borderBottomWidth="1px"
        borderColor="border.muted"
        justifyContent="space-between"
        color="fg.muted"
        _hover={{ backgroundColor: "bg.muted" }}
      >
        <VStack align="start" gap={0}>
          <Text fontSize="sm" fontWeight="medium" color="blue.600">
            {title}
          </Text>
          <Text fontSize="xs" color="fg.muted" maxW="2xl">
            {description}
          </Text>
        </VStack>
        <ExternalLink size={16} />
      </HStack>
    </Link>
  );
}

function DepartmentList({
  orgId,
  departments,
  isLoading,
  onChanged,
}: {
  orgId: string;
  departments: Department[];
  isLoading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Department | null>(null);
  const [archiving, setArchiving] = useState<Department | null>(null);

  const archiveMutation = api.departments.archive.useMutation({
    onSuccess: async () => {
      toaster.create({ title: "Department archived", type: "success" });
      setArchiving(null);
      await onChanged();
    },
    onError: (e) =>
      toaster.create({ title: "Archive failed", description: e.message, type: "error" }),
  });

  return (
    <>
      <VStack
        align="stretch"
        gap={0}
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        overflow="hidden"
      >
        <Box
          paddingY={2}
          paddingX={3}
          borderBottomWidth="1px"
          borderColor="border.muted"
          backgroundColor="bg.subtle"
          fontSize="xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          Departments
        </Box>
        {isLoading ? (
          <Box padding={4}>
            <Spinner />
          </Box>
        ) : departments.length === 0 ? (
          <Box padding={4} color="fg.muted" fontSize="sm">
            No departments yet. Create one above to start attributing spend.
          </Box>
        ) : (
          departments.map((dept) => (
            <DepartmentRow
              key={dept.id}
              department={dept}
              onEdit={() => setEditing(dept)}
              onArchive={() => setArchiving(dept)}
            />
          ))
        )}
      </VStack>

      <DepartmentEditDrawer
        organizationId={orgId}
        department={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          void onChanged();
        }}
      />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={`Archive ${archiving?.name ?? "department"}?`}
        message="Spend already attributed to this department rolls up under Unassigned. The department stops appearing in the assignment pickers."
        confirmLabel="Archive"
        tone="warning"
        loading={archiveMutation.isLoading}
        onConfirm={() => {
          if (archiving) {
            archiveMutation.mutate({ organizationId: orgId, id: archiving.id });
          }
        }}
      />
    </>
  );
}

function DepartmentRow({
  department,
  onEdit,
  onArchive,
}: {
  department: Department;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <HStack
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      fontSize="sm"
      justifyContent="space-between"
    >
      <Text fontWeight="medium">{department.name}</Text>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="ghost" size="xs" aria-label="Actions">
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="edit" onClick={onEdit}>
            <Pencil size={14} /> Edit
          </Menu.Item>
          <Menu.Item value="archive" onClick={onArchive}>
            <Archive size={14} /> Archive
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </HStack>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("organization:manage", {
    bypassOnboardingRedirect: true,
  })(DepartmentsPage),
);
