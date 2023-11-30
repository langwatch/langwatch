import { useRouter } from "next/router";
import { useToast } from "@chakra-ui/react";
import CheckConfigForm, {
  type CheckConfigFormData,
} from "../../../../components/CheckConfigForm";
import { api } from "../../../../utils/api";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { DashboardLayout } from "../../../../components/DashboardLayout";

export default function EditCheck() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const toast = useToast();

  const checkId = typeof router.query.id == "string" ? router.query.id : "";
  const { data: check, isLoading } = api.checks.getById.useQuery(
    { id: checkId, projectId: project?.id ?? "" },
    { enabled: !!project }
  );
  const updateCheck = api.checks.update.useMutation();

  if (isLoading) return null;

  const onSubmit = async (data: CheckConfigFormData) => {
    if (!project) return;

    try {
      await updateCheck.mutateAsync({
        ...data,
        id: checkId,
        projectId: project.id,
        parameters: {},
      });
      toast({
        title: "Check updated successfully",
        status: "success",
        duration: 5000,
        isClosable: true,
      });
      void router.push(`/${project.slug}/checks`);
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

  const defaultValues = check
    ? {
        ...check,
        checkType: check.checkType as CheckConfigFormData["checkType"],
      }
    : undefined;

  return (
    <DashboardLayout>
      <CheckConfigForm defaultValues={defaultValues} onSubmit={onSubmit} />
    </DashboardLayout>
  );
}
