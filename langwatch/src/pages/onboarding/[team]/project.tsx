import {
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  VStack,
} from "@chakra-ui/react";
import { type Team } from "@prisma/client";
import { type GetServerSidePropsContext } from "next";
import { getSession } from "next-auth/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { SetupLayout } from "~/components/SetupLayout";
import { api } from "~/utils/api";
import { getServerSideHelpers } from "../../../utils/serverHelpers";

type ProjectFormData = {
  name: string;
  techStack: string;
};

export default function ProjectOnboarding({ team }: { team: Team | null }) {
  const { register, handleSubmit } = useForm<ProjectFormData>();
  const router = useRouter();

  const createProject = api.project.create.useMutation();

  const onSubmit: SubmitHandler<ProjectFormData> = (data: ProjectFormData) => {
    if (!team) return;

    createProject.mutate({
      name: data.name,
      teamId: team.id,
      techStack: data.techStack,
    });
  };

  useEffect(() => {
    if (createProject.isSuccess) {
      void router.push("/dashboard");
    }
  }, [createProject.isSuccess, router]);

  if (!team) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <SetupLayout>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <VStack gap={4}>
          <FormControl>
            <FormLabel>Project Name</FormLabel>
            <Input {...register("name", { required: true })} />
          </FormControl>
          <FormControl>
            <FormLabel>Tech Stack</FormLabel>
            <Input {...register("techStack", { required: true })} />
          </FormControl>
          {createProject.error && (
            <p>Something went wrong! {createProject.error.message}</p>
          )}
          <HStack width="full">
            <Button
              colorScheme="orange"
              type="submit"
              disabled={createProject.isLoading}
            >
              {createProject.isLoading ? "Loading..." : "Next"}
            </Button>
          </HStack>
        </VStack>
      </form>
    </SetupLayout>
  );
}

export const getServerSideProps = async (
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

  const helpers = await getServerSideHelpers(context);
  const { team: teamSlug } = context.query;
  const team =
    typeof teamSlug == "string"
      ? await helpers.team.getBySlug.fetch({ slug: teamSlug })
      : null;

  return {
    props: {
      team,
      session,
    },
  };
};
