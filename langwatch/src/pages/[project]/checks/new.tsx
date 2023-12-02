import { Container, Heading, VStack, useToast } from "@chakra-ui/react";
import { useRouter } from "next/router";
import CheckConfigForm, {
  type CheckConfigFormData,
} from "../../../components/checks/CheckConfigForm";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";

export default function NewTraceCheckConfig() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const toast = useToast();
  const createCheck = api.checks.create.useMutation();

  const onSubmit = async (data: CheckConfigFormData) => {
    if (!project) return;

    try {
      await createCheck.mutateAsync({
        ...data,
        projectId: project.id,
        preconditions: [],
        parameters: data.parameters,
      });
      toast({
        title: "Check created successfully",
        status: "success",
        duration: 5000,
        isClosable: true,
      });
      await router.push(`/${project.slug}/checks`);
    } catch (error) {
      toast({
        title: "Failed to create check",
        description: "Please try again",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
        <VStack align="start">
          <Heading as="h1" size="xl" textAlign="center" my={6}>
            New Check
          </Heading>
          <CheckConfigForm
            onSubmit={onSubmit}
            defaultValues={{ checkType: "custom" }}
            isLoading={createCheck.isLoading}
          />
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
