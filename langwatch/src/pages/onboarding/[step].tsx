import { useRouter } from "next/router";
import { useEffect } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { api } from "~/utils/api";
import ErrorPage from "next/error";
import {
  Box,
  Button,
  Card,
  CardBody,
  Container,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  VStack,
} from "@chakra-ui/react";
import { signIn, useSession } from "next-auth/react";

type OrganizationFormData = {
  organizationName: string;
};

export default function OnboardingStep({ step }: { step: string }) {
  const { data: session } = useSession();
  const router = useRouter();

  // useEffect(() => {
  //   if (!session) {
  //     void signIn("auth0");
  //   }
  // }, [session, router]);

  if (!session) {
    return <h1>Not logged in!</h1>;
  }

  if (!["organization", "project"].includes(step)) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <Box
      width="full"
      height="full"
      minHeight="100vh"
      backgroundColor="gray.300"
      paddingTop={16}
    >
      <Container>
        <Card>
          <CardBody>
            {step === "organization" && <SetupOrganization />}
            {step === "project" && <SetupProject />}
          </CardBody>
        </Card>
      </Container>
    </Box>
  );
}

export const getServerSideProps = (context: { query: { step: string } }) => {
  const { step } = context.query;

  return {
    props: {
      step,
    },
  };
};

function SetupOrganization() {
  const { register, handleSubmit } = useForm<OrganizationFormData>();
  const { data: session } = useSession();
  const router = useRouter();

  const createOrganization = api.organization.createAndAssign.useMutation();

  const onSubmit: SubmitHandler<OrganizationFormData> = (
    data: OrganizationFormData
  ) => {
    createOrganization.mutate({
      orgName: data.organizationName,
    });
  };

  useEffect(() => {
    if (createOrganization.isSuccess) {
      void router.push("/onboarding/project");
    }
  }, [createOrganization.isSuccess, router]);

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <VStack gap={4}>
        <FormControl>
          <FormLabel>Name</FormLabel>
          <Input type="text" disabled value={session?.user.name ?? ""} />
        </FormControl>
        <FormControl>
          <FormLabel>Email</FormLabel>
          <Input type="email" disabled value={session?.user.email ?? ""} />
        </FormControl>
        <FormControl>
          <FormLabel>Organization Name</FormLabel>
          <Input {...register("organizationName", { required: true })} />
          <FormHelperText>
            If you are signing up for a personal account, you can use your own
            name
          </FormHelperText>
        </FormControl>
        {createOrganization.error && (
          <p>Something went wrong! {createOrganization.error.message}</p>
        )}
        <HStack width="full">
          <Button
            colorScheme="orange"
            type="submit"
            disabled={createOrganization.isLoading}
          >
            {createOrganization.isLoading ? "Loading..." : "Next"}
          </Button>
        </HStack>
      </VStack>
    </form>
  );
}

function SetupProject() {
  return <h1>Setup new project</h1>;
}
