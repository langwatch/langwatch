import {
  Button,
  Checkbox,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Heading,
  Input,
  Link,
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
import {
  PhoneInput,
  buildCountryData,
  defaultCountries,
  parseCountry,
} from "react-international-phone";
import "react-international-phone/style.css";

type OrganizationFormData = {
  organizationName?: string;
  phoneNumber: string;
  terms: boolean;
};

export default function OrganizationOnboarding() {
  const { data: session } = useRequiredSession();

  const form = useForm<OrganizationFormData>();
  const { register, handleSubmit, formState, reset: resetForm } = form;
  const router = useRouter();
  const toast = useToast();
  const returnTo =
    typeof router.query.return_to === "string"
      ? router.query.return_to
      : undefined;

  const createOrganization = api.organization.createAndAssign.useMutation();
  const apiContext = api.useContext();

  const onSubmit: SubmitHandler<OrganizationFormData> = (
    data: OrganizationFormData
  ) => {
    createOrganization.mutate(
      {
        orgName: data.organizationName,
        phoneNumber: data.phoneNumber,
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
            `/onboarding/${createOrganization.data.teamSlug}/project${
              returnTo ? `?return_to=${returnTo}` : ""
            }`
          );
        });
      })();
    }
  }, [
    apiContext.organization.getAll,
    createOrganization.data?.teamSlug,
    createOrganization.isSuccess,
    returnTo,
    router,
  ]);

  if (!session) {
    return <LoadingScreen />;
  }

  const phoneNumber = register("phoneNumber", { required: true });

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
            <FormLabel>Phone Number</FormLabel>
            <PhoneInput
              {...phoneNumber}
              autoFocus
              countries={defaultCountries.map((country) => {
                const country_ = parseCountry(country);
                if (country_.iso2 === "nl") {
                  return buildCountryData({
                    ...country_,
                    format: ". ........",
                  });
                }
                return country;
              })}
              inputStyle={{ width: "100%", border: "1px solid #e6e9f0" }}
              countrySelectorStyleProps={{
                buttonStyle: {
                  borderColor: "#e6e9f0",
                  paddingLeft: "8px",
                  paddingRight: "8px",
                },
              }}
              onChange={(phone) => {
                void phoneNumber.onChange({
                  target: {
                    value: phone,
                  },
                });
              }}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Organization Name (optional)</FormLabel>
            <Input {...register("organizationName", { required: false })} />
          </FormControl>
          <FormControl marginTop={4} isInvalid={!!formState.errors?.terms}>
            <Checkbox {...register("terms", { required: true })}>
              <Text fontSize={14}>
                I agree with LangWatch{" "}
                <Link
                  href="https://langwatch.ai/terms"
                  textDecoration="underline"
                  isExternal
                  _hover={{
                    textDecoration: "none",
                  }}
                >
                  terms of service
                </Link>
              </Text>
            </Checkbox>
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
