import {
  Alert,
  Box,
  Button,
  Card,
  Container,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { MoreVertical } from "react-feather";
import { useRouter } from "@langwatch/workflow-web/studio-host/next-router";
import CheckConfigForm, {
  type CheckConfigFormData,
} from "../../components/checks/check-config-form";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { toaster } from "@langwatch/workflow-web/studio-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/studio-host/api";

/**
 * The legacy online-evaluation edit form, at `/:project/evaluations/:id/edit`.
 *
 * WHY THIS PACKAGE, AND WHY IT MOVED AT ALL. The evaluations/evaluators
 * manifest recorded these two keys as BLOCKED, with a number: "~8,000 lines of
 * copies to move a legacy form the online evaluation drawer superseded",
 * 1,414 of them `~/server/tracer/tracesMapping`, which 31 modules read. That
 * block was argued under the old copy rule, and the number is now zero — the
 * trace family MOVED `tracesMapping` and `components/traces/TracesMapping` into
 * `@langwatch/trace-web`, and the studio slice moved `CheckConfigForm` and its
 * whole exclusive closure (`TryItOut`, `EvaluatorSelection`,
 * `PreconditionsField`, `EvaluatorLLMConfigField`, `EvaluationManualIntegration`,
 * `DynamicZodForm`) into this package. Nothing was copied to land this screen;
 * the page body was already here.
 *
 * The transport is `monitors.*`, which by the ownership rule is
 * `@langwatch/monitor-web`'s — recorded and overruled on the FORM: every
 * component this page renders is the evaluator family's and already lives here,
 * and moving the page to monitor-web would have meant either a package-crossing
 * import of eight private modules or moving them a second time. The two keys
 * are the evaluator package's until the legacy form is retired for the drawer
 * that superseded it.
 *
 * `DashboardLayout` does not travel — chrome belongs to the route tree.
 */
export default function EditTraceCheck() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  const checkId = typeof router.query.id == "string" ? router.query.id : "";
  const check = api.monitors.getById.useQuery(
    { id: checkId, projectId: project?.id ?? "" },
    { enabled: !!project },
  );
  const updateCheck = api.monitors.update.useMutation();
  const deleteCheck = api.monitors.delete.useMutation();
  const utils = api.useUtils();
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);

  const onSubmit = async (data: CheckConfigFormData) => {
    if (!project || !data.checkType) return;

    try {
      await updateCheck.mutateAsync({
        ...data,
        checkType: data.checkType,
        id: checkId,
        projectId: project.id,
      });
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
      <Container maxWidth="1200" padding={6}>
        <VStack align="start" gap={4}>
          <HStack align="end" width="full">
            <Heading as="h1" size="xl" textAlign="center" paddingTop={4}>
              Editing Evaluation
            </Heading>
            <Spacer />
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button>
                  <MoreVertical />
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item value="delete" color="red.fg" onClick={handleDeleteCheck}>
                  Delete Check
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          </HStack>

          {check.isLoading ? (
            <Card.Root width="full">
              <Card.Body>
                <VStack gap={4} width="full">
                  <Skeleton width="full" height="20px" />
                  <Skeleton width="full" height="20px" />
                  <Skeleton width="full" height="20px" />
                </VStack>
              </Card.Body>
            </Card.Root>
          ) : check.isError ? (
            <Alert.Root status="error">
              <Alert.Indicator />
              <Alert.Content>
                An error has occurred trying to load the check configs
              </Alert.Content>
            </Alert.Root>
          ) : (
            <CheckConfigForm
              checkId={checkId}
              defaultValues={defaultValues}
              onSubmit={onSubmit}
              loading={updateCheck.isPending}
            />
          )}
        </VStack>
      </Container>
    </Box>
  );
}
