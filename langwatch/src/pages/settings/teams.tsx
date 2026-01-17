import {
  Button,
  Card,
  Heading,
  HStack,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Archive, MoreVertical, Plus } from "lucide-react";
import { toaster } from "~/components/ui/toaster";
import SettingsLayout from "../../components/SettingsLayout";
import { Link } from "../../components/ui/link";
import { Menu } from "../../components/ui/menu";
import { Tooltip } from "../../components/ui/tooltip";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { TeamWithProjectsAndMembersAndUsers } from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

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
  const queryClient = api.useContext();
  const archiveTeam = api.team.archiveById.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "Team archived successfully",
        type: "success",
      });
      void queryClient.team.getTeamsWithMembers.invalidate();
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
    if (
      confirm(
        "Are you sure you want to archive this team? This action cannot be undone.",
      )
    ) {
      archiveTeam.mutate({ teamId, projectId: project?.id ?? "" });
    }
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
            {hasTeamManagePermission ? (
              <Link href={`/settings/teams/new`} asChild>
                <PageLayout.HeaderButton>
                  <Plus size={20} />
                  Add new team
                </PageLayout.HeaderButton>
              </Link>
            ) : (
              <PageLayout.HeaderButton disabled>
                <Plus size={20} />
                Add new team
              </PageLayout.HeaderButton>
            )}
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
                  <Link
                    href={`/settings/teams/${team.slug}`}
                    _hover={{ textDecoration: "underline" }}
                  >
                    {team.name}
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  {team.members.length}{" "}
                  {team.members.length == 1 ? "member" : "members"}
                </Table.Cell>
                <Table.Cell>
                  {team.projects.length}{" "}
                  {team.projects.length == 1 ? "project" : "projects"}
                </Table.Cell>
                <Table.Cell align="right">
                  <Menu.Root>
                    <Menu.Trigger className="js-inner-menu">
                      <MoreVertical size={18} />
                    </Menu.Trigger>
                    <Menu.Content className="js-inner-menu">
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
    </SettingsLayout>
  );
}
