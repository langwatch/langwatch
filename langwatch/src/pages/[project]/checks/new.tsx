import { useRouter } from "next/router";
import { useToast } from "@chakra-ui/react";
import CheckConfigForm, {
  type CheckConfigFormData,
} from "../../../components/CheckConfigForm";
import { api } from "../../../utils/api";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { DashboardLayout } from "../../../components/DashboardLayout";

export default function NewTraceCheckConfig() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const toast = useToast();
  const createTraceCheckConfig = api.checks.create.useMutation();

  const onSubmit = async (data: CheckConfigFormData) => {
    if (!project) return;

    try {
      await createTraceCheckConfig.mutateAsync({
        ...data,
        projectId: project.id,
        parameters: {},
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
      <CheckConfigForm onSubmit={onSubmit} />
    </DashboardLayout>
  );
}
