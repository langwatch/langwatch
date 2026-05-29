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
import { CostCenterEditDrawer } from "~/components/settings/CostCenterEditDrawer";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

type CostCenter = RouterOutputs["costCenters"]["list"][number];

function CostCentersPage() {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";

  const utils = api.useUtils();
  const listQuery = api.costCenters.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const refresh = async () => {
    await utils.costCenters.list.invalidate({ organizationId: orgId });
  };

  const [newName, setNewName] = useState("");
  const createMutation = api.costCenters.create.useMutation({
    onSuccess: async () => {
      setNewName("");
      toaster.create({ title: "Cost center created", type: "success" });
      await refresh();
    },
    onError: (e) =>
      toaster.create({ title: "Create failed", description: e.message, type: "error" }),
  });

  const costCenters = listQuery.data ?? [];
  const hasCostCenters = costCenters.length > 0;

  return (
    <GovernanceLayout pageTitle="Cost Centers · AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <VStack align="start" gap={1}>
          <Text fontSize="xs" color="fg.muted">
            <Link href="/governance" color="blue.600">
              ← AI Governance
            </Link>{" "}
            · Cost centers
          </Text>
          <Heading size="md">Cost centers</Heading>
          <Text color="fg.muted" fontSize="sm" maxW="2xl">
            A cost center is an accounting label for spend. Assign people,
            teams, and projects to one, and spend rolls up by cost center
            across the org, including personal AI use. Cost centers never
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
            Create a cost center
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

        <CostCenterList
          orgId={orgId}
          costCenters={costCenters}
          isLoading={listQuery.isLoading}
          onChanged={refresh}
        />

        {hasCostCenters && <AssignmentGuide />}
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
          Assigning cost centers
        </Text>
        <Text fontSize="xs" color="fg.subtle" marginTop={1}>
          Assign people and teams to a cost center where you already manage
          them. Spend rolls up by cost center, including personal AI use.
        </Text>
      </Box>
      <AssignmentLink
        href="/settings/members"
        title="People"
        description="A person's spend, including personal AI use, rolls up to their cost center. Assign each member from the members page."
      />
      <AssignmentLink
        href="/settings/teams"
        title="Teams"
        description="A team cost center is the default its members and projects inherit when they have none of their own. Assign each team from the teams page."
      />
      <AssignmentLink
        href="/settings/teams"
        title="Projects"
        description="A project is where an autonomous agent runs. Agent spend with no human principal rolls up to the project's cost center. Assign each project from the teams page, next to its team."
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

function CostCenterList({
  orgId,
  costCenters,
  isLoading,
  onChanged,
}: {
  orgId: string;
  costCenters: CostCenter[];
  isLoading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [archiving, setArchiving] = useState<CostCenter | null>(null);

  const archiveMutation = api.costCenters.archive.useMutation({
    onSuccess: async () => {
      toaster.create({ title: "Cost center archived", type: "success" });
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
          Cost centers
        </Box>
        {isLoading ? (
          <Box padding={4}>
            <Spinner />
          </Box>
        ) : costCenters.length === 0 ? (
          <Box padding={4} color="fg.muted" fontSize="sm">
            No cost centers yet. Create one above to start attributing spend.
          </Box>
        ) : (
          costCenters.map((cc) => (
            <CostCenterRow
              key={cc.id}
              costCenter={cc}
              onEdit={() => setEditing(cc)}
              onArchive={() => setArchiving(cc)}
            />
          ))
        )}
      </VStack>

      <CostCenterEditDrawer
        organizationId={orgId}
        costCenter={editing}
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
        title={`Archive ${archiving?.name ?? "cost center"}?`}
        message="Spend already attributed to this cost center rolls up under Unassigned. The cost center stops appearing in the assignment pickers."
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

function CostCenterRow({
  costCenter,
  onEdit,
  onArchive,
}: {
  costCenter: CostCenter;
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
      <Text fontWeight="medium">{costCenter.name}</Text>
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
  })(CostCentersPage),
);
