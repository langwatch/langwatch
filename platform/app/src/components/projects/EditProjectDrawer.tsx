import {
  Button,
  createListCollection,
  Field,
  HStack,
  Heading,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useMemo } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
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

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    control,
  } = useForm<EditProjectFormData>({
    defaultValues: {
      name: projectName ?? "",
      teamId: currentTeamId ?? "",
    },
  });

  const updateProject = api.project.update.useMutation();

  const teamOptions = useMemo(
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
    () => createListCollection({ items: teamOptions }),
    [teamOptions],
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
      size="lg"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) closeDrawer();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.CloseTrigger onClick={closeDrawer} />
          <Heading>Edit Project</Heading>
        </Drawer.Header>
        <Drawer.Body>
          <form onSubmit={handleSubmit(onSubmit)}>
            <VStack align="stretch" gap={6}>
              <Text fontSize="sm" color="fg.muted">
                Update the project name or move it to a different team.
                Moving a project changes which team members inherit access.
              </Text>

              <Field.Root invalid={!!errors.name}>
                <Field.Label>Project Name</Field.Label>
                <Input
                  {...register("name", {
                    required: "Project name is required",
                    minLength: { value: 1, message: "Name is required" },
                  })}
                  placeholder="AI Project"
                />
                {errors.name && (
                  <Field.ErrorText>{errors.name.message}</Field.ErrorText>
                )}
              </Field.Root>

              <Field.Root>
                <Field.Label>Team</Field.Label>
                <Controller
                  control={control}
                  name="teamId"
                  rules={{ required: "Team is required" }}
                  render={({ field }) => (
                    <Select.Root
                      collection={teamCollection}
                      value={[field.value]}
                      onValueChange={(details) => {
                        const selectedValue = details.value[0];
                        if (selectedValue) {
                          field.onChange(selectedValue);
                        }
                      }}
                    >
                      <Select.Trigger>
                        <Select.ValueText placeholder="Select team">
                          {() =>
                            teamOptions.find((o) => o.value === field.value)
                              ?.label ?? "Select team"
                          }
                        </Select.ValueText>
                      </Select.Trigger>
                      <Select.Content paddingY={2}>
                        {teamOptions.map((option) => (
                          <Select.Item key={option.value} item={option}>
                            {option.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  )}
                />
              </Field.Root>

              <HStack width="full">
                <Spacer />
                <Button
                  colorPalette="orange"
                  type="submit"
                  loading={updateProject.isLoading}
                  disabled={!isDirty || updateProject.isLoading}
                >
                  Save
                </Button>
              </HStack>
            </VStack>
          </form>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
