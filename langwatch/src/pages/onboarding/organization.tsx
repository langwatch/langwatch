import {
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  VStack,
} from "@chakra-ui/react";
import { type GetServerSideProps, type GetServerSidePropsContext } from "next";
import { type Session } from "next-auth";
import { getSession, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { api } from "~/utils/api";
import { SetupLayout } from "~/components/SetupLayout";

type OrganizationFormData = {
  organizationName: string;
};

type Props = {
  user: Session["user"];
};

export default function OrganizationOnboarding({ user }: Props) {
  const { register, handleSubmit } = useForm<OrganizationFormData>();
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
      void router.push(
        `/onboarding/${createOrganization.data.teamSlug}/project`
      );
    }
  }, [createOrganization.data?.teamSlug, createOrganization.isSuccess, router]);

  return (
    <SetupLayout>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <VStack gap={4}>
          <FormControl>
            <FormLabel>Name</FormLabel>
            <Input type="text" disabled value={user.name ?? ""} />
          </FormControl>
          <FormControl>
            <FormLabel>Email</FormLabel>
            <Input type="email" disabled value={user.email ?? ""} />
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
    </SetupLayout>
  );
}

export const getServerSideProps = (async (
  context: GetServerSidePropsContext
) => {
  const session = await getSession(context);

  if (!session) {
    return {
      redirect: {
        destination: "/auth/signin",
        permanent: false,
      },
    };
  }

  return {
    props: {
      user: session.user,
    },
  };
}) satisfies GetServerSideProps<Props>;
