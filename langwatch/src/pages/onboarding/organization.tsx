import {
  Box,
  Button,
  Field,
  HStack,
  Heading,
  Input,
  SegmentGroup,
  Separator,
  Steps,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import React, { useEffect } from "react";
import {
  Briefcase,
  Cloud,
  Server,
  User,
  Users,
} from "react-feather";
import {
  Controller,
  useForm,
  type SubmitHandler,
  type UseFormRegister,
} from "react-hook-form";
import {
  PhoneInput,
  buildCountryData,
  defaultCountries,
  parseCountry,
} from "react-international-phone";
import "react-international-phone/style.css";
import { SetupLayout } from "~/components/SetupLayout";
import { api } from "~/utils/api";
import { LoadingScreen } from "../../components/LoadingScreen";
import { Checkbox } from "../../components/ui/checkbox";
import { Link } from "../../components/ui/link";
import { RadioGroup } from "../../components/ui/radio";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { titleCase } from "../../utils/stringCasing";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { LuBinoculars, LuCode, LuCpu, LuEarth, LuExternalLink, LuEye, LuFlaskConical, LuFlaskRound, LuMicroscope, LuPresentation, LuProjector, LuShare2, LuUserSearch, LuWandSparkles } from "react-icons/lu";
import { toaster } from "~/components/ui/toaster";

type OrganizationFormData = {
  organizationName: string;
  phoneNumber: string;
  terms: boolean;
  usage: string;
  solution: string;
  companySize: string;
  featureUsage: string;
  yourRole: string;
  utmCampaign: string | null;
};

const options = {
  "For my company": <Briefcase size={16} color="orange" />,
  "For my clients": <Users size={16} color="orange" />,
  "For myself": <User size={16} color="orange" />,
};

const langwatchSolution = {
  "SaaS": <Cloud size={16} color="orange" />,
  "On-Premise": <Server size={16} color="orange" />,
};

const featureUsage: Record<string, React.ReactNode> = {
  "Evaluating": <LuMicroscope size={16} color="orange" />,
  "Everything": <LuEarth size={16} color="orange" />,
  "Model/Prompt experimentation": <LuFlaskConical size={16} color="orange" />,
  "Monitoring & Observability": <LuBinoculars size={16} color="orange" />,
  "Collaboration & annotation": <LuShare2 size={16} color="orange" />,
  "Just looking": <LuEye size={16} color="orange" />,
};

const roles: Record<string, React.ReactNode> = {
  "AI Engineer": <LuWandSparkles size={16} color="orange" />,
  "Data Scientist": <LuFlaskRound size={16} color="orange" />,
  "Software Engineer": <LuCode size={16} color="orange" />,
  "Product Manager": <LuPresentation size={16} color="orange" />,
  "Engineering Manager": <LuProjector size={16} color="orange" />,
  "CTO/Founder": <LuCpu size={16} color="orange" />,
  "Other": <LuUserSearch size={16} color="orange" />,
};

const companySize = [
  "Solo",
  "2-10",
  "11-50",
  "51-200",
  "201-1000",
  "1000+",
];

export default function OrganizationOnboarding() {
  const { organization, isLoading: organizationIsLoading } =
    useOrganizationTeamProject({
      redirectToProjectOnboarding: false,
    });

  const { data: session } = useRequiredSession();
  const utmCampaign =
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("utm_campaign")
      : null;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    getValues,
    setError,
    formState: { errors },
    reset: resetForm,
    control,
  } = useForm<OrganizationFormData>({
    mode: "onChange",
    defaultValues: {
      utmCampaign,
    },
  });
  const router = useRouter();
  const returnTo =
    typeof router.query.return_to === "string"
      ? router.query.return_to
      : undefined;

  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS;

  const initializeOrganization = api.onboarding.initializeOrganization.useMutation();
  const apiContext = api.useContext();
  const [activeStep, setActiveStep] = React.useState(0);

  const onSubmit: SubmitHandler<OrganizationFormData> = (
    data: OrganizationFormData
  ) => {
    const formattedData = {
      ...data,
      terms: Boolean(data.terms),
    };

    initializeOrganization.mutate(
      {
        orgName: formattedData.organizationName,
        phoneNumber: formattedData.phoneNumber,
        signUpData: formattedData,
      },
      {
        onSuccess: (response) => {
          window.location.href = `/${response.projectSlug}/messages`;
        },
        onError: () => {
          toaster.create({
            title: "Failed to create organization",
            description: "Please try that again",
            type: "error",
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
          resetForm();
        },
      }
    );
  };

  useEffect(() => {
    if (organization && !initializeOrganization.isSuccess) {
      void router.push(`/`);
    }
  }, [organization, router, initializeOrganization.isSuccess]);

  if (
    !session ||
    (!initializeOrganization.isSuccess && (!!organization || organizationIsLoading))
  ) {
    return <LoadingScreen />;
  }

  const phoneNumber = register("phoneNumber");
  const selectedValueUsage = watch("usage");
  const selectedValueSolution = watch("solution");
  const selectedValueFeatureUsage = watch("featureUsage");
  const selectedValueYourRole = watch("yourRole");
  const myselfSelected = watch("usage") === "For myself" && Boolean(watch("usage"));

  const steps = isSaaS && !myselfSelected ? 3 : 1;

  const checkFirstStep = async () => {
    const organizationName = getValues("organizationName");
    const terms = getValues("terms");
    const usage = getValues("usage");
    const solution = getValues("solution");

    if (myselfSelected) {
      setValue("phoneNumber", "");
    }

    if (!organizationName) {
      setError("organizationName", {
        message: "Organization name is required",
      });
    }
    if (!terms) {
      setError("terms", {
        message: "Please agree to terms",
      });
    }
    if (!usage) {
      setError("usage", {
        message: "Please select how you will be using LangWatch",
      });
    }
    if (!solution) {
      setError("solution", {
        message: "Please select a solution",
      });
    }

    if (organizationName && terms && usage && solution) {
      if (myselfSelected) {
        await handleSubmit(onSubmit)();
      } else {
        setActiveStep(1);
      }
    }
  };

  const checkSecondStep = () => {
    if (!isSaaS) return;
    if (myselfSelected) return;

    const companySize = getValues("companySize");
    const yourRole = getValues("yourRole");
    const featureUsage = getValues("featureUsage");

    if (!companySize) {
      setError("companySize", {
        message: "Please select a company size",
      });
    }
    if (!yourRole) {
      setError("yourRole", {
        message: "Please select your role",
      });
    }
    if (!featureUsage) {
      setError("featureUsage", {
        message: "Please select a feature usage",
      });
    }

    return companySize && yourRole && featureUsage;
  };

  return (
    <SetupLayout>
      <form onSubmit={handleSubmit(onSubmit)}>
        <VStack gap={4} alignItems="left">
          <Steps.Root
            step={activeStep}
            onStepChange={(e) => setActiveStep(e.step)}
            count={steps}
          >
            {isSaaS && (
              <Steps.List
                margin={myselfSelected ? '0 auto' : ''}
                marginBottom={2}
              >
                <Steps.Item index={0} title={'1'}>
                  <Steps.Indicator />
                  <Steps.Separator />
                </Steps.Item>
                {!myselfSelected && (
                  <Steps.Item index={1} title={'2'}>
                    <Steps.Indicator />
                    <Steps.Separator />
                  </Steps.Item>
                )}
              </Steps.List>
            )}

            <Steps.Content index={0}>
              <Heading as="h1" fontSize="x-large">
                Organization Details
              </Heading>
              <Text paddingBottom={4} fontSize="14px">
                Create the organization that will hold your projects on
                LangWatch
              </Text>
              <Field.Root hidden={session.user.name !== undefined}>
                <Field.Label>Name</Field.Label>
                <Input type="text" disabled value={session.user.name ?? ""} />
              </Field.Root>
              <Field.Root hidden={session.user.email !== undefined}>
                <Field.Label>Email</Field.Label>
                <Input type="email" disabled value={session.user.email ?? ""} />
              </Field.Root>
              <VStack gap={4}>
                <Field.Root invalid={!!errors?.organizationName}>
                  <Field.Label flexDirection={'column'} alignItems={'flex-start'} gap={0}>
                    Organization name
                    <Text as={'div'} fontSize={"x-small"} color={"GrayText"}>
                      {"If you\'re using LangWatch for yourself, you can use your own name."}
                    </Text>
                  </Field.Label>
                  <Input
                    autoFocus
                    {...register("organizationName", { required: true })}
                  />
                  <Field.ErrorText>
                    Organization name is required
                  </Field.ErrorText>
                </Field.Root>

                {isSaaS && (
                  <React.Fragment>
                    <Field.Root invalid={!!errors.usage}>
                      <Field.Label>How will you be using LangWatch?</Field.Label>
                      <RadioGroup
                        value={selectedValueUsage || ""}
                        onValueChange={(e) => setValue("usage", e.value)}
                      >
                        <HStack width="full" wrap="wrap">
                          {Object.entries(options).map(([value, icon]) => (
                            <CustomRadio
                              key={value}
                              value={value}
                              registerProps={register("usage", {
                                required: "This field is required",
                              })}
                              selectedValue={selectedValueUsage}
                              icon={icon}
                            />
                          ))}
                        </HStack>
                      </RadioGroup>
                      <Field.ErrorText>{errors.usage?.message}</Field.ErrorText>
                    </Field.Root>

                    {getValues("usage") !== "For myself" && getValues("usage") && (
                      <Field.Root>
                        <Field.Label>
                          Phone number
                          <Text fontSize={"x-small"} color={"GrayText"}>optional</Text>
                        </Field.Label>
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
                      </Field.Root>
                    )}

                    <Field.Root invalid={!!errors.solution}>
                      <Field.Label>
                        What solution are you interested in?
                      </Field.Label>
                      <RadioGroup
                        value={selectedValueSolution || ""}
                        onValueChange={(e) => setValue("solution", e.value)}
                      >
                        <HStack width="full" wrap="wrap">
                          {Object.entries(langwatchSolution).map(
                            ([value, icon]) => (
                              <CustomRadio
                                key={value}
                                value={value}
                                registerProps={register("solution", {
                                  required: "This field is required",
                                })}
                                selectedValue={selectedValueSolution}
                                icon={icon}
                              />
                            )
                          )}
                        </HStack>
                      </RadioGroup>
                      <Field.ErrorText>
                        {errors.solution?.message}
                      </Field.ErrorText>
                    </Field.Root>
                  </React.Fragment>
                )}

                <Field.Root invalid={!!errors?.terms}>
                  <Checkbox {...register("terms", { required: true })}>
                    <Text fontSize="14px">
                      I agree with LangWatch{" "}
                      <Link
                        href="https://langwatch.ai/legal/terms-conditions"
                        isExternal
                        textDecoration={'underline'}
                      >
                        terms of service
                        <LuExternalLink />
                      </Link>
                    </Text>
                  </Checkbox>
                  <Field.ErrorText>Please agree to terms</Field.ErrorText>
                </Field.Root>

                {utmCampaign && (
                  <Field.Root>
                    <Text fontSize="14px">
                      You are signing up via the{" "}
                      <b>{titleCase(utmCampaign.replaceAll("-", " "))}</b>{" "}
                      campaign
                    </Text>
                  </Field.Root>
                )}

                <Separator />
                <HStack width="full">
                  <Button
                    colorPalette="orange"
                    type={isSaaS ? "button" : "submit"}
                    disabled={
                      initializeOrganization.isLoading ||
                      initializeOrganization.isSuccess
                    }
                    loading={initializeOrganization.isLoading}
                    onClick={() => {
                      if (isSaaS) {
                        void checkFirstStep();
                      }
                    }}
                  >
                    Next
                  </Button>
                </HStack>
              </VStack>
            </Steps.Content>

            {getValues("usage") !== "For myself" && getValues("usage") && isSaaS && (
              <React.Fragment>
                <Steps.Content index={1}>
                  <Heading as="h1" fontSize="x-large">
                    Company Details
                  </Heading>
                  <Text paddingBottom={4} fontSize="14px">
                    Tell us a bit about your organization
                  </Text>
                  <VStack gap={4}>
                    <Field.Root invalid={!!errors.companySize}>
                      <Field.Label>Company size</Field.Label>
                      <Controller
                        control={control}
                        name="companySize"
                        render={({ field: { onChange, value } }) => (
                          <SegmentGroup.Root
                            size={'sm'}
                            cursor={'pointer'}
                            onValueChange={(e) => onChange(e.value)}
                            value={value}
                          >
                            <SegmentGroup.Indicator background={'white'} />
                            {companySize.map((value) => (
                              <SegmentGroup.Item key={value} value={value}>
                                <SegmentGroup.ItemText>{value}</SegmentGroup.ItemText>
                                <SegmentGroup.ItemHiddenInput />
                              </SegmentGroup.Item>
                            ))}
                          </SegmentGroup.Root>
                        )}
                      />
                      <Field.ErrorText>
                        {errors.companySize?.message}
                      </Field.ErrorText>
                    </Field.Root>

                    <Field.Root invalid={!!errors.featureUsage}>
                      <Field.Label>What brings you to LangWatch?</Field.Label>
                      <RadioGroup
                        value={selectedValueFeatureUsage || ""}
                        onValueChange={(e) => setValue("featureUsage", e.value)}
                      >
                        <HStack width="full" wrap="wrap">
                          {Object.entries(featureUsage).map(
                            ([value, icon]) => (
                              <CustomRadio
                                key={value}
                                value={value}
                                registerProps={register("featureUsage", {
                                  required: "This field is required",
                                })}
                                selectedValue={selectedValueFeatureUsage}
                                icon={icon}
                              />
                            )
                          )}
                        </HStack>
                      </RadioGroup>
                      <Field.ErrorText>
                        {errors.featureUsage?.message}
                      </Field.ErrorText>
                    </Field.Root>
                    <Field.Root invalid={!!errors.yourRole}>
                      <Field.Label>What is your role?</Field.Label>
                      <RadioGroup
                        value={selectedValueYourRole || ""}
                        onValueChange={(e) => setValue("yourRole", e.value)}
                      >
                        <HStack width="full" wrap="wrap">
                          {Object.entries(roles).map(
                            ([value, icon]) => (
                              <CustomRadio
                                key={value}
                                value={value}
                                registerProps={register("yourRole", {
                                  required: "This field is required",
                                })}
                                selectedValue={selectedValueYourRole}
                                icon={icon}
                              />
                            )
                          )}
                        </HStack>
                      </RadioGroup>
                      <Field.ErrorText>
                        {errors.yourRole?.message}
                      </Field.ErrorText>
                    </Field.Root>

                    <Separator />

                    <HStack width="full">
                      <Steps.PrevTrigger asChild>
                        <Button
                          variant="outline"
                          type="button"
                          disabled={initializeOrganization.isLoading}
                        >
                          Back
                        </Button>
                      </Steps.PrevTrigger>

                      <Button
                        colorPalette="orange"
                        type="submit"
                        onClick={(e) => {
                          if (!checkSecondStep()) {
                            e.preventDefault();
                          }
                        }}
                        disabled={
                          initializeOrganization.isLoading ||
                          initializeOrganization.isSuccess
                        }
                      >
                        {initializeOrganization.isLoading ||
                          initializeOrganization.isSuccess
                          ? "Loading..."
                          : "Next"}
                      </Button>
                    </HStack>
                  </VStack>
                </Steps.Content>
              </React.Fragment>
            )}
          </Steps.Root>

          {initializeOrganization.error && <p>Something went wrong!</p>}
        </VStack>
      </form>
    </SetupLayout>
  );
}

const CustomRadio = ({
  value,
  registerProps,
  selectedValue,
  icon,
}: {
  value: string;
  registerProps: ReturnType<UseFormRegister<OrganizationFormData>>;
  selectedValue: string;
  icon: React.ReactNode;
}) => {
  return (
    <Button
      as="label"
      variant="plain"
      key={value}
      marginTop={1}
      height="auto"
      padding="0"
      border="none"
      boxShadow="none"
      color="inherit"
    >
      <input
        type="radio"
        value={value}
        {...registerProps}
        checked={selectedValue === value}
        style={{ display: "none" }}
      />
      <Box
        cursor="pointer"
        borderRadius="md"
        borderWidth="1px"
        borderColor={selectedValue === value ? "orange.500" : "white.300"}
        _checked={{
          borderColor: "orange.400",
        }}
        _active={{ borderColor: "orange.600" }}
        px={5}
        py={3}
        userSelect="none"
      >
        <HStack>
          {icon}
          <Text>{value}</Text>
        </HStack>
      </Box>
    </Button>
  );
};
