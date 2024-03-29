import {
  Card,
  CardBody,
  FormErrorMessage,
  HStack,
  Heading,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
  useToast,
} from "@chakra-ui/react";
import isEqual from "lodash.isequal";
import { useEffect, useState } from "react";
import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { HorizontalFormControl } from "~/components/HorizontalFormControl";
import SettingsLayout from "../components/SettingsLayout";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import type { FullyLoadedOrganization } from "../server/api/routers/organization";
import { api } from "../utils/api";
import { OrganizationRoleGroup } from "../server/api/permission";

type OrganizationFormData = {
  name: string;
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
  const { hasOrganizationPermission } = useOrganizationTeamProject();
  const [defaultValues, setDefaultValues] = useState<OrganizationFormData>({
    name: organization.name,
  });
  const { register, handleSubmit, control, getFieldState } = useForm({
    defaultValues,
  });
  const formWatch = useWatch({ control });
  const updateOrganization = api.organization.update.useMutation();
  const apiContext = api.useContext();
  const toast = useToast();

  const onSubmit: SubmitHandler<OrganizationFormData> = useDebouncedCallback(
    (data: OrganizationFormData) => {
      if (isEqual(data, defaultValues)) return;

      setDefaultValues(data);

      updateOrganization.mutate(
        {
          organizationId: organization.id,
          name: data.name,
        },
        {
          onSuccess: () => {
            void apiContext.organization.getAll.refetch();
          },
          onError: () => {
            toast({
              title: "Failed to create organization",
              description: "Please try that again",
              status: "error",
              duration: 5000,
              isClosable: true,
              position: "top-right",
            });
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
                <HorizontalFormControl
                  label="Name"
                  helper="The name of your organization"
                  isInvalid={!!getFieldState("name").error}
                >
                  {hasOrganizationPermission(
                    OrganizationRoleGroup.ORGANIZATION_MANAGE
                  ) ? (
                    <>
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
                    </>
                  ) : (
                    <Text>{organization.name}</Text>
                  )}
                </HorizontalFormControl>
                <HorizontalFormControl
                  label="Slug"
                  helper="The unique ID of your organization"
                >
                  {hasOrganizationPermission(
                    OrganizationRoleGroup.ORGANIZATION_MANAGE
                  ) ? (
                    <Input
                      width="full"
                      disabled
                      type="text"
                      value={organization.slug}
                    />
                  ) : (
                    <Text>{organization.slug}</Text>
                  )}
                </HorizontalFormControl>
              </VStack>
            </form>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}
