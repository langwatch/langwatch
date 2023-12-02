import { useRouter } from "next/router";
import {
  Alert,
  AlertIcon,
  Card,
  CardBody,
  Container,
  Heading,
  Skeleton,
  VStack,
  useToast,
} from "@chakra-ui/react";
import CheckConfigForm, {
  type CheckConfigFormData,
} from "../../../../components/CheckConfigForm";
import { api } from "../../../../utils/api";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { DashboardLayout } from "../../../../components/DashboardLayout";
import checks from "../../checks";

export default function EditCheck() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const toast = useToast();

  const checkId = typeof router.query.id == "string" ? router.query.id : "";
  const check = api.checks.getById.useQuery(
    { id: checkId, projectId: project?.id ?? "" },
    { enabled: !!project }
  );
  const updateCheck = api.checks.update.useMutation();

  const onSubmit = async (data: CheckConfigFormData) => {
    if (!project) return;

    try {
      await updateCheck.mutateAsync({
        ...data,
        id: checkId,
        projectId: project.id,
        parameters: {
          rules: data.customRules,
        },
      });
      toast({
        title: "Check updated successfully",
        status: "success",
        duration: 5000,
        isClosable: true,
      });
      void router.push(`/${project.slug}/checks`);
      check.remove();
    } catch (error) {
      toast({
        title: "Failed to update check",
        description: "Please try again",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const defaultValues = check.data
    ? {
        ...check.data,
        checkType: check.data.checkType as CheckConfigFormData["checkType"],
      }
    : undefined;

  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
        <VStack align="start">
          <Heading as="h1" size="xl" textAlign="center" my={6}>
            Editing Check
          </Heading>
          {check.isLoading ? (
            <Card width="full">
              <CardBody>
                <VStack gap={4} width="full">
                  <Skeleton width="full" height="20px" />
                  <Skeleton width="full" height="20px" />
                  <Skeleton width="full" height="20px" />
                </VStack>
              </CardBody>
            </Card>
          ) : check.isError ? (
            <Alert status="error">
              <AlertIcon />
              An error has occurred trying to load the check configs
            </Alert>
          ) : (
            <CheckConfigForm
              defaultValues={defaultValues}
              onSubmit={onSubmit}
              isLoading={updateCheck.isLoading}
            />
          )}
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
