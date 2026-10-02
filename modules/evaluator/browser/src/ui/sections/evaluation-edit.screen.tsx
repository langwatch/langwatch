import { toaster } from "@langwatch/browser-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Alert, Box, Card, Skeleton, Spacer, VStack } from "@langwatch/design-system/primitives";
import { monitorApiUpdateInputSchema } from "@langwatch/monitor-contract";
import { useState } from "react";
import { MoreVertical } from "react-feather";

import { evaluatorApi } from "../../behavior/evaluator-api.ts";
import CheckConfigForm, { type CheckConfigFormData } from "./checks/check-config-form.tsx";

/**
 * The legacy online-evaluation edit form, at `/:project/evaluations/:id/edit`. WHY THIS
 * PACKAGE, AND WHY IT MOVED AT ALL.
 */
export default function EditTraceCheck() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  const checkId = typeof router.query.id === "string" ? router.query.id : "";
  const check = evaluatorApi.monitors.getById.useQuery(
    { id: checkId, projectId: project?.id ?? "" },
    { enabled: !!project },
  );
  const updateCheck = evaluatorApi.monitors.update.useMutation();
  const deleteCheck = evaluatorApi.monitors.delete.useMutation();
  const utils = evaluatorApi.useUtils();
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);

  const onSubmit = async (data: CheckConfigFormData) => {
    if (!project || !data.checkType) return;

    try {
      await updateCheck.mutateAsync(
        monitorApiUpdateInputSchema.parse({
          ...data,
          checkType: data.checkType,
          id: checkId,
          projectId: project.id,
        }),
      );
      toaster.create({
        title: "Check updated successfully",
        type: "success",
      });
      void router.push(`/${project.slug}/online-evaluations`);
      void utils.monitors.getById.invalidate({
        id: checkId,
        projectId: project.id,
      });
    } catch {
      toaster.create({
        title: "Failed to update check",
        description: "Please try again",
        type: "error",
      });
    }
  };

  const handleDeleteCheck = () => {
    if (!project) return;
    setIsConfirmDeleteOpen(true);
  };

  const defaultValues = check.data
    ? {
        ...check.data,
        checkType: check.data.checkType as CheckConfigFormData["checkType"],
        preconditions: check.data.preconditions as CheckConfigFormData["preconditions"],
        settings: check.data.parameters as CheckConfigFormData["settings"],
        mappings: check.data.mappings as CheckConfigFormData["mappings"],
      }
    : undefined;
  const checkFailed = !check.isLoading && check.isError;
  const checkReady = !check.isLoading && !check.isError;

  return (
    <Box width="full">
      <ConfirmDialog
        open={isConfirmDeleteOpen}
        onOpenChange={setIsConfirmDeleteOpen}
        title="Delete check"
        message="Are you sure you want to delete this check?"
        confirmLabel="Delete"
        tone="danger"
        loading={deleteCheck.isPending}
        onConfirm={() => {
          if (!project) return;
          deleteCheck.mutate(
            { id: checkId, projectId: project.id },
            {
              onSuccess: () => {
                toaster.create({
                  title: "Check deleted successfully",
                  type: "success",
                });
                void router.push(`/${project.slug}/online-evaluations`);
              },
              onError: () => {
                toaster.create({
                  title: "Failed to delete check",
                  description: "Please try again",
                  type: "error",
                });
              },
              onSettled: () => setIsConfirmDeleteOpen(false),
            },
          );
        }}
      />
      <PageLayout.Header>
        <PageLayout.Heading>Editing Evaluation</PageLayout.Heading>
        <Spacer />
        <Menu.Root>
          <Menu.Trigger asChild>
            <PageLayout.HeaderButton>
              <MoreVertical />
            </PageLayout.HeaderButton>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item value="delete" color="red.fg" onClick={handleDeleteCheck}>
              Delete Check
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </PageLayout.Header>
      <PageLayout.Container>
        <VStack align="start" gap={4}>
          {check.isLoading && (
            <Card.Root width="full">
              <Card.Body>
                <VStack gap={4} width="full">
                  <Skeleton width="full" height="20px" />
                  <Skeleton width="full" height="20px" />
                  <Skeleton width="full" height="20px" />
                </VStack>
              </Card.Body>
            </Card.Root>
          )}
          {checkFailed && (
            <Alert.Root status="error">
              <Alert.Indicator />
              <Alert.Content>An error has occurred trying to load the check configs</Alert.Content>
            </Alert.Root>
          )}
          {checkReady && (
            <CheckConfigForm
              checkId={checkId}
              defaultValues={defaultValues}
              onSubmit={onSubmit}
              loading={updateCheck.isPending}
            />
          )}
        </VStack>
      </PageLayout.Container>
    </Box>
  );
}
