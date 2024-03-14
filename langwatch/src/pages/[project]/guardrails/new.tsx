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
    if (!project || !data.checkType) return;

    try {
      await createCheck.mutateAsync({
        ...data,
        checkType: data.checkType,
        projectId: project.id,
      });
      toast({
        title: "Check created successfully",
        status: "success",
        duration: 5000,
        isClosable: true,
      });
      await router.push(`/${project.slug}/guardrails`);
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
        <VStack align="start" spacing={4}>
          <Heading as="h1" size="xl" textAlign="center" paddingTop={4}>
            Setup Evaluation
          </Heading>
          <CheckConfigForm
            onSubmit={onSubmit}
            defaultValues={{ sample: 1.0 }}
            isLoading={createCheck.isLoading}
          />
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
