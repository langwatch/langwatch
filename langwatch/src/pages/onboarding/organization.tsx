import {
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Heading,
  Input,
  Text,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { SetupLayout } from "~/components/SetupLayout";
import { api } from "~/utils/api";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { LoadingScreen } from "../../components/LoadingScreen";

type OrganizationFormData = {
  organizationName: string;
};

export default function OrganizationOnboarding() {
  const { data: session } = useRequiredSession();

  const {
    register,
    handleSubmit,
    reset: resetForm,
  } = useForm<OrganizationFormData>();
  const router = useRouter();
  const toast = useToast();

  const createOrganization = api.organization.createAndAssign.useMutation();
  const apiContext = api.useContext();

  const onSubmit: SubmitHandler<OrganizationFormData> = (
    data: OrganizationFormData
  ) => {
    createOrganization.mutate(
      {
        orgName: data.organizationName,
      },
      {
        onError: () => {
          toast({
            title: "Failed to create organization",
            description: "Please try that again",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          resetForm();
        },
      }
    );
  };

  useEffect(() => {
    if (createOrganization.isSuccess) {
      void (async () => {
        await apiContext.organization.getAll.refetch();
        // For some reason even though we await for the refetch it's not done yet when we move pages
        setTimeout(() => {
          void router.push(
            `/onboarding/${createOrganization.data.teamSlug}/project`
          );
        });
      })();
    }
  }, [
    apiContext.organization.getAll,
    createOrganization.data?.teamSlug,
    createOrganization.isSuccess,
    router,
  ]);

  if (!session) {
    return <LoadingScreen />;
  }

  return (
    <SetupLayout>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <VStack gap={4} alignItems="left">
          <Heading as="h1" fontSize="x-large">
            Setup Organization
          </Heading>
          <Text paddingBottom={4} fontSize="14px">
            Create the organization that will hold your projects on LangWatch
          </Text>
          <FormControl>
            <FormLabel>Name</FormLabel>
            <Input type="text" disabled value={session.user.name ?? ""} />
          </FormControl>
          <FormControl>
            <FormLabel>Email</FormLabel>
            <Input type="email" disabled value={session.user.email ?? ""} />
          </FormControl>
          <FormControl>
            <FormLabel>Organization Name</FormLabel>
            <Input
              autoFocus
              {...register("organizationName", { required: true })}
            />
            <FormHelperText>
              If you are signing up for a personal account, you can use your own
              name
            </FormHelperText>
          </FormControl>
          {createOrganization.error && <p>Something went wrong!</p>}
          <HStack width="full">
            <Button
              colorScheme="orange"
              type="submit"
              disabled={createOrganization.isLoading}
            >
              {createOrganization.isLoading || createOrganization.isSuccess
                ? "Loading..."
                : "Next"}
            </Button>
          </HStack>
        </VStack>
      </form>
    </SetupLayout>
  );
}
