import { useRouter } from "next/router";
import {
  Button,
  Card,
  Container,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { Alert } from "@chakra-ui/react";
import { Menu } from "../../../../components/ui/menu";
import { toaster } from "../../../../components/ui/toaster";
import CheckConfigForm, {
  type CheckConfigFormData,
} from "../../../../components/checks/CheckConfigForm";
import { api } from "../../../../utils/api";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { DashboardLayout } from "../../../../components/DashboardLayout";
import { MoreVertical } from "react-feather";

export default function EditTraceCheck() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  const checkId = typeof router.query.id == "string" ? router.query.id : "";
  const check = api.checks.getById.useQuery(
    { id: checkId, projectId: project?.id ?? "" },
    { enabled: !!project }
  );
  const updateCheck = api.checks.update.useMutation();
  const deleteCheck = api.checks.delete.useMutation();

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
        meta: {
          closable: true,
        },
      });
      void router.push(`/${project.slug}/evaluations`);
      check.remove();
    } catch (error) {
      toaster.create({
        title: "Failed to update check",
        description: "Please try again",
        type: "error",
        meta: {
          closable: true,
        },
      });
    }
  };

  const handleDeleteCheck = () => {
    if (!project) return;

    if (window.confirm("Are you sure you want to delete this check?")) {
      deleteCheck.mutate(
        { id: checkId, projectId: project.id },
        {
          onSuccess: () => {
            toaster.create({
              title: "Check deleted successfully",
              type: "success",
              meta: {
                closable: true,
              },
            });
            void router.push(`/${project.slug}/evaluations`);
          },
          onError: () => {
            toaster.create({
              title: "Failed to delete check",
              description: "Please try again",
              type: "error",
              meta: {
                closable: true,
              },
            });
          },
        }
      );
    }
  };

  const defaultValues = check.data
    ? {
        ...check.data,
        checkType: check.data.checkType as CheckConfigFormData["checkType"],
        preconditions: check.data
          .preconditions as CheckConfigFormData["preconditions"],
        settings: check.data.parameters as CheckConfigFormData["settings"],
        mappings: check.data.mappings as CheckConfigFormData["mappings"],
      }
    : undefined;

  return (
    <DashboardLayout>
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
                <Menu.Item
                  value="delete"
                  color="red.600"
                  onClick={handleDeleteCheck}
                >
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
              loading={updateCheck.isLoading}
            />
          )}
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
