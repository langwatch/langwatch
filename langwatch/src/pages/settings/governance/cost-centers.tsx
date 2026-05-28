import {
  Box,
  Button,
  Heading,
  HStack,
  Input,
  NativeSelect,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

type CostCenter = RouterOutputs["costCenters"]["list"][number];
type AssignableEntity =
  RouterOutputs["costCenters"]["assignments"]["users"][number];

const UNASSIGNED = "";

function CostCentersPage() {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const { enabled, isLoading: ffLoading } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    { organizationId: orgId, enabled: !!orgId },
  );

  const utils = api.useUtils();
  const listQuery = api.costCenters.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const assignmentsQuery = api.costCenters.assignments.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const refresh = async () => {
    await Promise.all([
      utils.costCenters.list.invalidate({ organizationId: orgId }),
      utils.costCenters.assignments.invalidate({ organizationId: orgId }),
    ]);
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

  if (ffLoading) return <LoadingScreen />;
  if (!enabled) return <NotFoundScene />;

  const costCenters = listQuery.data ?? [];
  const assignments = assignmentsQuery.data;

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

        {assignmentsQuery.isLoading || !assignments ? (
          <Box padding={6}>
            <Spinner />
          </Box>
        ) : (
          <>
            <AssignmentSection
              title="People"
              description="A person's spend, including personal AI use, rolls up to their cost center."
              entities={assignments.users}
              costCenters={costCenters}
              orgId={orgId}
              kind="user"
              onChanged={refresh}
            />
            <AssignmentSection
              title="Teams"
              description="A team cost center is the default its members and projects inherit when they have none of their own."
              entities={assignments.teams}
              costCenters={costCenters}
              orgId={orgId}
              kind="team"
              onChanged={refresh}
            />
            <AssignmentSection
              title="Projects"
              description="A project is where an autonomous agent runs. Agent spend with no human principal rolls up to the project's cost center."
              entities={assignments.projects}
              costCenters={costCenters}
              orgId={orgId}
              kind="project"
              onChanged={refresh}
            />
          </>
        )}
      </VStack>
    </GovernanceLayout>
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

function AssignmentSection({
  title,
  description,
  entities,
  costCenters,
  orgId,
  kind,
  onChanged,
}: {
  title: string;
  description: string;
  entities: AssignableEntity[];
  costCenters: CostCenter[];
  orgId: string;
  kind: "user" | "team" | "project";
  onChanged: () => Promise<void>;
}) {
  const assignUser = api.costCenters.assignUser.useMutation();
  const assignTeam = api.costCenters.assignTeam.useMutation();
  const assignProject = api.costCenters.assignProject.useMutation();

  const assign = async (entityId: string, costCenterId: string | null) => {
    try {
      if (kind === "user") {
        await assignUser.mutateAsync({
          organizationId: orgId,
          userId: entityId,
          costCenterId,
        });
      } else if (kind === "team") {
        await assignTeam.mutateAsync({
          organizationId: orgId,
          teamId: entityId,
          costCenterId,
        });
      } else {
        await assignProject.mutateAsync({
          organizationId: orgId,
          projectId: entityId,
          costCenterId,
        });
      }
      toaster.create({ title: "Assignment saved", type: "success" });
      await onChanged();
    } catch (e) {
      toaster.create({
        title: "Assignment failed",
        description: e instanceof Error ? e.message : String(e),
        type: "error",
      });
    }
  };

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
          {title}
        </Text>
        <Text fontSize="xs" color="fg.subtle" marginTop={1}>
          {description}
        </Text>
      </Box>
      {entities.length === 0 ? (
        <Box padding={4} color="fg.muted" fontSize="sm">
          None to assign.
        </Box>
      ) : (
        entities.map((entity) => (
          <HStack
            key={entity.id}
            paddingY={2}
            paddingX={3}
            borderBottomWidth="1px"
            borderColor="border.muted"
            fontSize="sm"
            justifyContent="space-between"
          >
            <Text>{entity.name}</Text>
            <NativeSelect.Root size="sm" maxW="220px">
              <NativeSelect.Field
                value={entity.costCenterId ?? UNASSIGNED}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  void assign(entity.id, e.target.value || null)
                }
              >
                <option value={UNASSIGNED}>Unassigned</option>
                {costCenters.map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.name}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </HStack>
        ))
      )}
    </VStack>
  );
}

export default withPermissionGuard("organization:manage", {
  bypassOnboardingRedirect: true,
})(CostCentersPage);
