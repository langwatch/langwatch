import { Container, Heading, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import CheckConfigForm, {
  type CheckConfigFormData,
} from "../../../components/checks/CheckConfigForm";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
import { toaster } from "../../../components/ui/toaster";

export default function NewTraceCheckConfig() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const createCheck = api.monitors.create.useMutation();

  const onSubmit = async (data: CheckConfigFormData) => {
    if (!project || !data.checkType) return;

    try {
      await createCheck.mutateAsync({
        ...data,
        checkType: data.checkType,
        projectId: project.id,
      });
      toaster.create({
        title: "Check created successfully",
        type: "success",
        duration: 5000,
        meta: {
          closable: true,
        },
      });
      await router.push(`/${project.slug}/evaluations`);
    } catch (error) {
      toaster.create({
        title: "Failed to create check",
        description: "Please try again",
        type: "error",
        duration: 5000,
        meta: {
          closable: true,
        },
      });
    }
  };

  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
        <VStack align="start" gap={4}>
          <Heading as="h1" size="xl" textAlign="center" paddingTop={4}>
            Setup Evaluation
          </Heading>
          <CheckConfigForm
            onSubmit={onSubmit}
            defaultValues={{ sample: 1.0 }}
            loading={createCheck.isLoading}
          />
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
