import {
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Archive, Edit, MoreVertical, Plus } from "lucide-react";
import { useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import SettingsLayout from "../../components/SettingsLayout";
import { Menu } from "../../components/ui/menu";
import { Tooltip } from "../../components/ui/tooltip";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { TeamWithProjectsAndMembersAndUsers } from "../../server/api/routers/organization";
import { api } from "../../utils/api";

function Teams() {
  const { organization } = useOrganizationTeamProject();

  const teams = api.team.getTeamsWithMembers.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    { enabled: !!organization },
  );

  if (!teams.data) return <SettingsLayout />;

  return <TeamsList teams={teams.data} />;
}

export default withPermissionGuard("team:view", {
  layoutComponent: SettingsLayout,
})(Teams);

function TeamsList({ teams }: { teams: TeamWithProjectsAndMembersAndUsers[] }) {
  const { hasPermission, project } = useOrganizationTeamProject();
  const hasTeamManagePermission = hasPermission("team:manage");
  const { openDrawer } = useDrawer();
  const queryClient = api.useContext();
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [teamToArchive, setTeamToArchive] = useState<string | null>(null);

  const archiveTeam = api.team.archiveById.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "Team archived successfully",
        type: "success",
      });
      void queryClient.team.getTeamsWithMembers.invalidate();
      setShowArchiveDialog(false);
      setTeamToArchive(null);
    },
  });

  const onArchiveTeam = (teamId: string) => {
    if (!hasPermission("team:manage")) return;
    if (teams.length === 1) {
      toaster.create({
        title: "You cannot archive the last team",
        type: "error",
      });
      return;
    }
    setTeamToArchive(teamId);
    setShowArchiveDialog(true);
  };

  const handleConfirmArchive = () => {
    if (teamToArchive) {
      archiveTeam.mutate({ teamId: teamToArchive, projectId: project?.id ?? "" });
    }
  };

  const handleCancelArchive = () => {
    setShowArchiveDialog(false);
    setTeamToArchive(null);
  };

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full">
          <Heading>Teams</Heading>
          <Spacer />
          <Tooltip
            content={
              !hasTeamManagePermission
                ? "You need team:manage permission to create teams"
                : undefined
            }
            disabled={hasTeamManagePermission}
            positioning={{ placement: "bottom" }}
            showArrow
          >
            <PageLayout.HeaderButton
              onClick={hasTeamManagePermission ? () => openDrawer("createTeam") : undefined}
              disabled={!hasTeamManagePermission}
            >
              <Plus size={20} />
              Add new team
            </PageLayout.HeaderButton>
          </Tooltip>
        </HStack>
        <Table.Root variant="line" width="full" size="md">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Members</Table.ColumnHeader>
              <Table.ColumnHeader>Projects</Table.ColumnHeader>
              <Table.ColumnHeader w={"10PX"}>Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {teams.map((team) => (
              <Table.Row key={team.id}>
                <Table.Cell>
                  {hasTeamManagePermission ? (
                    <Box
                      as="button"
                      onClick={() => openDrawer("editTeam", { teamId: team.id })}
                      cursor="pointer"
                      _hover={{ textDecoration: "underline" }}
                      textAlign="left"
                      data-testid={`team-name-button-${team.id}`}
                    >
                      {team.name}
                    </Box>
                  ) : (
                    <Text>{team.name}</Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {team.members.length}{" "}
                  {team.members.length === 1 ? "member" : "members"}
                </Table.Cell>
                <Table.Cell>
                  {team.projects.length}{" "}
                  {team.projects.length === 1 ? "project" : "projects"}
                </Table.Cell>
                <Table.Cell align="right">
                  <Menu.Root>
                    <Menu.Trigger className="js-inner-menu">
                      <MoreVertical size={18} />
                    </Menu.Trigger>
                    <Menu.Content className="js-inner-menu">
                      {hasTeamManagePermission && (
                        <Menu.Item
                          value="edit"
                          onClick={() => openDrawer("editTeam", { teamId: team.id })}
                        >
                          <Edit size={14} />
                          Edit
                        </Menu.Item>
                      )}
                      <Menu.Item
                        value="archive"
                        color="red.500"
                        onClick={() => onArchiveTeam(team.id)}
                        disabled={
                          !hasPermission("team:manage") || archiveTeam.isPending
                        }
                      >
                        <Archive size={14} />
                        Archive
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Root>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </VStack>

      {/* Archive Team Confirmation Dialog */}
      <Dialog.Root
        open={showArchiveDialog}
        onOpenChange={({ open }) => {
          if (!open) {
            handleCancelArchive();
          }
        }}
        placement="center"
      >
        <Dialog.Content>
          <Dialog.CloseTrigger />
          <Dialog.Header>
            <Dialog.Title fontSize="md" fontWeight="500">
              Archive Team
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text>
              Are you sure you want to archive this team? This action cannot be undone.
            </Text>
          </Dialog.Body>
          <Dialog.Footer gap={2}>
            <Button variant="outline" onClick={handleCancelArchive}>
              Cancel
            </Button>
            <Button
              colorPalette="red"
              onClick={handleConfirmArchive}
              loading={archiveTeam.isPending}
            >
              Archive
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </SettingsLayout>
  );
}
