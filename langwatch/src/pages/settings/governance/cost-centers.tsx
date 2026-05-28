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
import { ExternalLink } from "lucide-react";
import { useState } from "react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
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
        href="/settings"
        title="Projects"
        description="A project is where an autonomous agent runs. Agent spend with no human principal rolls up to the project's cost center. Assign a project from its settings."
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
        <ExternalLink size={16} color="var(--chakra-colors-fg-muted)" />
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
  const renameMutation = api.costCenters.rename.useMutation({
    onSuccess: async () => {
      toaster.create({ title: "Cost center renamed", type: "success" });
      await onChanged();
    },
    onError: (e) =>
      toaster.create({ title: "Rename failed", description: e.message, type: "error" }),
  });
  const archiveMutation = api.costCenters.archive.useMutation({
    onSuccess: async () => {
      toaster.create({ title: "Cost center archived", type: "success" });
      await onChanged();
    },
    onError: (e) =>
      toaster.create({ title: "Archive failed", description: e.message, type: "error" }),
  });

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
            orgId={orgId}
            costCenter={cc}
            onRename={(name) =>
              renameMutation.mutate({ organizationId: orgId, id: cc.id, name })
            }
            onArchive={() =>
              archiveMutation.mutate({ organizationId: orgId, id: cc.id })
            }
            renaming={renameMutation.isLoading}
            archiving={archiveMutation.isLoading}
          />
        ))
      )}
    </VStack>
  );
}

function CostCenterRow({
  costCenter,
  onRename,
  onArchive,
  renaming,
  archiving,
}: {
  orgId: string;
  costCenter: CostCenter;
  onRename: (name: string) => void;
  onArchive: () => void;
  renaming: boolean;
  archiving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(costCenter.name);

  return (
    <HStack
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      fontSize="sm"
      justifyContent="space-between"
    >
      {editing ? (
        <HStack flex={1}>
          <Input
            size="sm"
            maxW="sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <Button
            size="xs"
            colorPalette="orange"
            loading={renaming}
            disabled={!draft.trim() || draft.trim() === costCenter.name}
            onClick={() => {
              onRename(draft.trim());
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setDraft(costCenter.name);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </HStack>
      ) : (
        <>
          <Text fontWeight="medium">{costCenter.name}</Text>
          <HStack>
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              Rename
            </Button>
            <Button
              size="xs"
              variant="ghost"
              colorPalette="red"
              loading={archiving}
              onClick={onArchive}
            >
              Archive
            </Button>
          </HStack>
        </>
      )}
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
