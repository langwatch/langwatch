import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Button,
  Card,
  CardBody,
  FormErrorMessage,
  HStack,
  Heading,
  Input,
  LinkBox,
  Spacer,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from "@chakra-ui/react";
import isEqual from "lodash.isequal";
import NextLink from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ChevronRight } from "react-feather";
import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import SettingsLayout, {
  SettingsFormControl,
} from "../../../components/SettingsLayout";
import type { TeamWithMembersAndProjects } from "../../../server/api/routers/organization";
import { api } from "../../../utils/api";

type TeamFormData = {
  name: string;
};

export default function Team() {
  const router = useRouter();
  const teamSlug = router.query.team;
  const team = api.team.getTeamWithMembers.useQuery(
    {
      slug: teamSlug as string,
    },
    { enabled: typeof teamSlug === "string" }
  );

  if (!team.data) return <SettingsLayout />;

  return <TeamForm team={team.data} />;
}

function TeamForm({ team }: { team: TeamWithMembersAndProjects }) {
  const [defaultValues, setDefaultValues] = useState<TeamFormData>({
    name: team.name,
  });
  const { register, handleSubmit, control, getFieldState } = useForm({
    defaultValues,
  });
  const formWatch = useWatch({ control });
  const updateTeam = api.team.update.useMutation();
  const apiContext = api.useContext();

  const onSubmit: SubmitHandler<TeamFormData> = useDebouncedCallback(
    (data: TeamFormData) => {
      if (isEqual(data, defaultValues)) return;

      setDefaultValues(data);

      updateTeam.mutate(
        {
          id: team.id,
          name: data.name,
        },
        {
          onSuccess: () => {
            void apiContext.organization.getAll.refetch();
          },
        }
      );
    },
    250
  );

  useEffect(() => {
    void handleSubmit(onSubmit)();
  }, [formWatch, handleSubmit, onSubmit]);

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <Breadcrumb spacing="8px" separator={<ChevronRight width="12" />}>
          <BreadcrumbItem>
            <BreadcrumbLink as={NextLink} href="/settings/teams">
              Teams
            </BreadcrumbLink>
          </BreadcrumbItem>

          <BreadcrumbItem isCurrentPage>
            <BreadcrumbLink>{team.name}</BreadcrumbLink>
          </BreadcrumbItem>
        </Breadcrumb>
        <HStack width="full">
          <Heading size="lg" as="h1">
            Team Settings
          </Heading>
          <Spacer />
          {updateTeam.isLoading && <Spinner />}
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={2}>
            <form onSubmit={void handleSubmit(onSubmit)}>
              <VStack spacing={0}>
                <SettingsFormControl
                  label="Name"
                  helper="The name of your team"
                  isInvalid={!!getFieldState("name").error}
                >
                  <Input
                    width="full"
                    type="text"
                    {...register("name", {
                      required: true,
                      validate: (value) => {
                        if (!value.trim()) return false;
                      },
                    })}
                  />
                  <FormErrorMessage>Name is required</FormErrorMessage>
                </SettingsFormControl>
                <SettingsFormControl
                  label="Slug"
                  helper="The unique ID of your team"
                >
                  <Input width="full" disabled type="text" value={team.slug} />
                </SettingsFormControl>
              </VStack>
            </form>
          </CardBody>
        </Card>
        <HStack width="full" marginTop={2}>
          <Heading size="md" as="h2">
            Members
          </Heading>
          <Spacer />
          <NextLink href={`/settings/members`}>
            <Button as="a" size="sm" colorScheme="orange">
              <HStack spacing={2}>
                <Text>Manage organization managers</Text>
              </HStack>
            </Button>
          </NextLink>
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={0} paddingX={0}>
            <Table variant="simple" width="full">
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                </Tr>
              </Thead>
              <Tbody>
                {team.members.map((member) => (
                  <LinkBox as="tr" key={team.id}>
                    <Td>{member.user.name}</Td>
                    <Td>{member.role}</Td>
                  </LinkBox>
                ))}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}
