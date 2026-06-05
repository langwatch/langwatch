import {
  Button,
  createListCollection,
  Field,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useMemo } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { Drawer } from "../ui/drawer";
import { Select } from "../ui/select";
import { toaster } from "../ui/toaster";

interface EditProjectFormData {
  name: string;
  teamId: string;
}

export function EditProjectDrawer({
  open = true,
  projectId,
  projectName,
  currentTeamId,
}: {
  open?: boolean;
  projectId?: string;
  projectName?: string;
  currentTeamId?: string;
}) {
  const { organization } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const queryClient = api.useContext();

  const teams = api.team.getTeamsWithMembers.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );

  const form = useForm<EditProjectFormData>({
    defaultValues: {
      name: projectName ?? "",
      teamId: currentTeamId ?? "",
    },
  });

  const updateProject = api.project.update.useMutation();

  const teamItems = useMemo(
    () =>
      (teams.data ?? [])
        .filter((t) => !t.isPersonal)
        .map((t) => ({
          label: t.name,
          value: t.id,
        })),
    [teams.data],
  );
  const teamCollection = useMemo(
    () => createListCollection({ items: teamItems }),
    [teamItems],
  );

  const onSubmit: SubmitHandler<EditProjectFormData> = useCallback(
    (data: EditProjectFormData) => {
      if (!projectId) return;

      updateProject.mutate(
        {
          projectId,
          ...(data.name !== projectName && { name: data.name }),
          ...(data.teamId !== currentTeamId && { teamId: data.teamId }),
        },
        {
          onSuccess: () => {
            void queryClient.team.getTeamsWithRoleBindings.invalidate();
            void queryClient.team.getTeamsWithMembers.invalidate();
            void queryClient.organization.getAll.invalidate();
            toaster.create({
              title: "Project updated",
              type: "success",
              duration: 5000,
              meta: { closable: true },
            });
            closeDrawer();
          },
          onError: (e) => {
            toaster.create({
              title: e.message,
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
          },
        },
      );
    },
    [updateProject, projectId, projectName, currentTeamId, queryClient, closeDrawer],
  );

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="md"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) closeDrawer();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>Edit Project</Drawer.Title>
          <Drawer.CloseTrigger onClick={closeDrawer} />
        </Drawer.Header>
        <Drawer.Body>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <VStack gap={5} align="stretch">
              <Field.Root>
                <Field.Label>Project Name</Field.Label>
                <input
                  {...form.register("name", { required: true, minLength: 1 })}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--chakra-colors-border)",
                    background: "transparent",
                    fontSize: "14px",
                  }}
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>Team</Field.Label>
                <Select.Root
                  collection={teamCollection}
                  value={[form.watch("teamId")]}
                  onValueChange={(e) => {
                    const v = e.value[0];
                    if (v) form.setValue("teamId", v, { shouldDirty: true });
                  }}
                  size="md"
                >
                  <Select.Trigger>
                    <Select.ValueText placeholder="Select team..." />
                  </Select.Trigger>
                  <Select.Content>
                    {teamItems.map((item) => (
                      <Select.Item key={item.value} item={item}>
                        {item.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Field.Root>

              <Button
                type="submit"
                colorPalette="blue"
                loading={updateProject.isPending}
                disabled={!form.formState.isDirty}
              >
                Save
              </Button>
            </VStack>
          </form>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
