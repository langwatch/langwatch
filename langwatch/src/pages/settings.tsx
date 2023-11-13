import {
  Card,
  CardBody,
  FormErrorMessage,
  HStack,
  Heading,
  Input,
  Spacer,
  Spinner,
  Switch,
  VStack,
} from "@chakra-ui/react";
import isEqual from "lodash.isequal";
import { useEffect, useState } from "react";
import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import SettingsLayout, {
  SettingsFormControl,
} from "../components/SettingsLayout";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import type { FullyLoadedOrganization } from "../server/api/routers/organization";
import { api } from "../utils/api";

type OrganizationFormData = {
  name: string;
  joinAllTeams: boolean;
};

export default function Settings() {
  const { organization } = useOrganizationTeamProject();

  if (!organization) return null;

  return <SettingsForm organization={organization} />;
}

function SettingsForm({
  organization,
}: {
  organization: FullyLoadedOrganization;
}) {
  const [defaultValues, setDefaultValues] = useState<OrganizationFormData>({
    name: organization.name,
    joinAllTeams: organization.joinAllTeams,
  });
  const { register, handleSubmit, control, getFieldState } = useForm({
    defaultValues,
  });
  const formWatch = useWatch({ control });
  const updateOrganization = api.organization.update.useMutation();
  const apiContext = api.useContext();

  const onSubmit: SubmitHandler<OrganizationFormData> = useDebouncedCallback(
    (data: OrganizationFormData) => {
      if (isEqual(data, defaultValues)) return;

      setDefaultValues(data);

      updateOrganization.mutate(
        {
          id: organization.id,
          name: data.name,
          joinAllTeams: data.joinAllTeams,
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
        <HStack width="full">
          <Heading size="lg" as="h1">
            Organization Settings
          </Heading>
          <Spacer />
          {updateOrganization.isLoading && <Spinner />}
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={2}>
            <form onSubmit={void handleSubmit(onSubmit)}>
              <VStack spacing={0}>
                <SettingsFormControl
                  label="Name"
                  helper="The name of your organization"
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
                  helper="The unique ID of your organization"
                >
                  <Input
                    width="full"
                    disabled
                    type="text"
                    value={organization.slug}
                  />
                </SettingsFormControl>
                {organization.teams.length > 0 && (
                  <SettingsFormControl
                    label="All teams access"
                    helper="Members of organization will also be members of all teams"
                  >
                    <Switch id="joinAllTeams" {...register("joinAllTeams")} />
                  </SettingsFormControl>
                )}
              </VStack>
            </form>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}
