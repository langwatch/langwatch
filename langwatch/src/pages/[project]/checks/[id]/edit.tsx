import { useRouter } from "next/router";
import {
  Alert,
  AlertIcon,
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Skeleton,
  Spacer,
  VStack,
  useToast,
} from "@chakra-ui/react";
import CheckConfigForm, {
  type CheckConfigFormData,
} from "../../../../components/checks/CheckConfigForm";
import { api } from "../../../../utils/api";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { DashboardLayout } from "../../../../components/DashboardLayout";
import { MoreVertical } from "react-feather";

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
  const deleteCheck = api.checks.delete.useMutation();

  const onSubmit = async (data: CheckConfigFormData) => {
    if (!project) return;

    try {
      await updateCheck.mutateAsync({
        ...data,
        id: checkId,
        projectId: project.id,
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

  const handleDeleteCheck = () => {
    if (!project) return;

    if (window.confirm("Are you sure you want to delete this check?")) {
      deleteCheck.mutate(
        { id: checkId, projectId: project.id },
        {
          onSuccess: () => {
            toast({
              title: "Check deleted successfully",
              status: "success",
              duration: 5000,
              isClosable: true,
            });
            void router.push(`/${project.slug}/checks`);
          },
          onError: () => {
            toast({
              title: "Failed to delete check",
              description: "Please try again",
              status: "error",
              duration: 5000,
              isClosable: true,
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
        parameters: check.data.parameters as CheckConfigFormData["parameters"],
      }
    : undefined;

  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
        <VStack align="start" spacing={4}>
          <HStack align="end" width="full">
            <Heading as="h1" size="xl" textAlign="center" paddingTop={4}>
              Editing Check
            </Heading>
            <Spacer />
            <Menu>
              <MenuButton as={Button}>
                <MoreVertical />
              </MenuButton>
              <MenuList>
                <MenuItem color="red.600" onClick={handleDeleteCheck}>
                  Delete Check
                </MenuItem>
              </MenuList>
            </Menu>
          </HStack>

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
