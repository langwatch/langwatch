import {
  Box,
  Button,
  Field,
  HStack,
  Heading,
  Input,
  Separator,
  Steps,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import React from "react";
import {
  Briefcase,
  Check,
  Cloud,
  Cpu,
  Database,
  DollarSign,
  FileText,
  Globe,
  Headphones,
  Heart,
  HelpCircle,
  Link as LinkIcon,
  Mail,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Search,
  Server,
  Share2,
  Tag,
  TrendingUp,
  User,
  Users,
} from "react-feather";
import {
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
import { toaster } from "../../components/ui/toaster";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { titleCase } from "../../utils/stringCasing";

type OrganizationFormData = {
  organizationName: string;
  phoneNumber: string;
  terms: boolean;
  usage: string;
  solution: string;
  projectType: string;
  companySize: string;
  howDidYouHearAboutUs: string;
  companyType: string;
  otherCompanyType: string;
  otherProjectType: string;
  otherHowDidYouHearAboutUs: string;
  utmCampaign: string | null;
};

export default function OrganizationOnboarding() {
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

  const createOrganization = api.organization.createAndAssign.useMutation();
  const apiContext = api.useContext();
  const steps = 3;
  const [activeStep, setActiveStep] = React.useState(0);

  const onSubmit: SubmitHandler<OrganizationFormData> = (
    data: OrganizationFormData
  ) => {
    const formattedData = {
      ...data,
      terms: Boolean(data.terms),
    };
    createOrganization.mutate(
      {
        orgName: formattedData.organizationName,
        phoneNumber: formattedData.phoneNumber,
        signUpData: formattedData,
      },
      {
        onSuccess: (data) => {
          void (async () => {
            await apiContext.organization.getAll.refetch();
            // For some reason even though we await for the refetch it's not done yet when we move pages
            setTimeout(() => {
              void router.push(
                `/onboarding/${data.teamSlug}/select${
                  returnTo ? `?return_to=${returnTo}` : ""
                }`
              );
            });
          })();
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

  if (!session) {
    return <LoadingScreen />;
  }

  const phoneNumber = register("phoneNumber", { required: true });

  const options = {
    "For my company": <Briefcase size={16} color="orange" />,
    "For my clients": <Users size={16} color="orange" />,
    "For myself": <User size={16} color="orange" />,
  };

  const langwatchSolution = {
    SaaS: <Cloud size={16} color="orange" />,
    "On-Premise": <Server size={16} color="orange" />,
  };

  const companyType = {
    "GenAI startup": <Cpu size={16} color="orange" />, // Representing tech and AI
    "Mid-Market": <TrendingUp size={16} color="orange" />, // Growth, business progression
    Enterprise: <Globe size={16} color="orange" />, // Large-scale, global business
    "Health-Care": <Heart size={16} color="orange" />, // Health/medical focus
    Financial: <DollarSign size={16} color="orange" />, // Finance, currency
    "Customer Service/Sales": <Headphones size={16} color="orange" />, // Customer support, interaction
    Other: <MoreHorizontal size={16} color="orange" />,
  };

  const companySize = {
    "1-10 employees": <User size={16} color="orange" />,
    "11-50 employees": <Users size={16} color="orange" />,
    "51-200 employees": <Users size={16} color="orange" />,
    "201-1000 employees": <Users size={16} color="orange" />,
    "1000+ employees": <Users size={16} color="orange" />,
  };

  const projectType = {
    "Q&A systems": <HelpCircle size={16} color="orange" />,
    Chatbots: <MessageCircle size={16} color="orange" />,
    "Text generation": <FileText size={16} color="orange" />,
    " RAG": <Database size={16} color="orange" />,
    "Classification tasks": <Tag size={16} color="orange" />,
    "Custom Evaluation": <Check size={16} color="orange" />,
    Other: <MoreHorizontal size={16} color="orange" />,
  };

  const howDidYouHearAboutUs = {
    "Social Media": <Share2 size={16} color="orange" />,
    "Search Engine": <Search size={16} color="orange" />,
    "Word of Mouth": <Users size={16} color="orange" />,
    Newsletter: <Mail size={16} color="orange" />,
    Conference: <Mic size={16} color="orange" />,
    Partner: <LinkIcon size={16} color="orange" />,
    Other: <MoreHorizontal size={16} color="orange" />,
  };

  const selectedValueUsage = watch("usage");
  const selectedValueSolution = watch("solution");
  const selectedValueCompanyType = watch("companyType");
  const selectedValueCompanySize = watch("companySize");
  const selectedValueProjectType = watch("projectType");
  const selectedValueHowDidYouHearAboutUs = watch("howDidYouHearAboutUs");

  const checkFirstStep = () => {
    const organizationName = getValues("organizationName");
    const terms = getValues("terms");
    const usage = getValues("usage");
    const solution = getValues("solution");

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
      setActiveStep(1);
    }
  };

  const checkSecondStep = () => {
    const companyType = getValues("companyType");
    const companySize = getValues("companySize");

    if (!companyType) {
      setError("companyType", {
        message: "Please select a company type",
      });
    }

    if (!companySize) {
      setError("companySize", {
        message: "Please select a company size",
      });
    }

    if (companyType && companySize) {
      setActiveStep(2);
    }
  };

  return (
    <SetupLayout>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <VStack gap={4} alignItems="left">
          {isSaaS && (
            <Box
              backgroundColor="gray.100"
              paddingX={2}
              paddingY={1}
              borderRadius={8}
              width="fit-content"
            >
              <Text fontSize="sm" fontWeight="medium" color="gray.500">
                {activeStep + 1} / {steps}
              </Text>
            </Box>
          )}
          <Steps.Root
            step={activeStep}
            onStepChange={(e) => setActiveStep(e.step)}
            count={steps}
          >
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
                  <Field.Label>Organization Name</Field.Label>
                  <Input
                    {...register("organizationName", { required: true })}
                  />
                  <Field.ErrorText>
                    Organization name is required
                  </Field.ErrorText>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Phone Number</Field.Label>
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

                {isSaaS && (
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
                )}
                {isSaaS && (
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
                )}
                <Field.Root invalid={!!errors?.terms}>
                  <Checkbox {...register("terms", { required: true })}>
                    <Text fontSize="14px">
                      I agree with LangWatch{" "}
                      <Link
                        href="https://langwatch.ai/legal/terms-conditions"
                        isExternal
                        _hover={{
                          textDecoration: "none",
                        }}
                      >
                        terms of service
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
                      createOrganization.isLoading ||
                      createOrganization.isSuccess
                    }
                    loading={createOrganization.isLoading}
                    onClick={() => {
                      if (isSaaS) {
                        checkFirstStep();
                      }
                    }}
                  >
                    Next
                  </Button>
                </HStack>
              </VStack>
            </Steps.Content>

            {isSaaS && (
              <Steps.Content index={1}>
                <Heading as="h1" fontSize="x-large">
                  Company Details
                </Heading>
                <Text paddingBottom={4} fontSize="14px">
                  Enter company type and team size to customize your LangWatch
                  experience.
                </Text>
                <VStack gap={4}>
                  <Field.Root invalid={!!errors.companyType}>
                    <Field.Label>Type of company?</Field.Label>
                    <RadioGroup
                      value={selectedValueCompanyType || ""}
                      onValueChange={(e) => setValue("companyType", e.value)}
                    >
                      <HStack width="full" wrap="wrap">
                        {Object.entries(companyType).map(([value, icon]) => {
                          return (
                            <React.Fragment key={value}>
                              <CustomRadio
                                value={value}
                                registerProps={register("companyType", {
                                  required: "Please select a company type",
                                })}
                                selectedValue={selectedValueCompanyType}
                                icon={icon}
                              />
                              {value === "Other" &&
                                selectedValueCompanyType === "Other" && (
                                  <Input
                                    type="text"
                                    {...register("otherCompanyType")}
                                    placeholder="Please specify"
                                  />
                                )}
                            </React.Fragment>
                          );
                        })}
                      </HStack>
                    </RadioGroup>
                    <Field.ErrorText>
                      {errors.companyType?.message}
                    </Field.ErrorText>
                  </Field.Root>
                  <Field.Root invalid={!!errors.companySize}>
                    <Field.Label>Company size?</Field.Label>
                    <RadioGroup
                      value={selectedValueCompanySize || ""}
                      onValueChange={(e) => setValue("companySize", e.value)}
                    >
                      <HStack width="full" wrap="wrap">
                        {Object.entries(companySize).map(([value, icon]) => {
                          return (
                            <CustomRadio
                              key={value}
                              value={value}
                              registerProps={register("companySize", {
                                required: "Please select a company size",
                              })}
                              selectedValue={selectedValueCompanySize}
                              icon={icon}
                            />
                          );
                        })}
                      </HStack>
                    </RadioGroup>
                    <Field.ErrorText>
                      {errors.companySize?.message}
                    </Field.ErrorText>
                  </Field.Root>
                  <Separator />
                  <HStack width="full">
                    <Steps.PrevTrigger asChild>
                      <Button
                        variant="outline"
                        type="button"
                        disabled={createOrganization.isLoading}
                      >
                        Back
                      </Button>
                    </Steps.PrevTrigger>

                    <Button
                      colorPalette="orange"
                      type="button"
                      disabled={createOrganization.isLoading}
                      onClick={() => checkSecondStep()}
                    >
                      {createOrganization.isLoading ||
                      createOrganization.isSuccess
                        ? "Loading..."
                        : "Next"}
                    </Button>
                  </HStack>
                </VStack>
              </Steps.Content>
            )}

            {isSaaS && (
              <Steps.Content index={2}>
                <Heading as="h1" fontSize="x-large">
                  Additional Information
                </Heading>
                <Text paddingBottom={4} fontSize="14px">
                  Enter your project type and how you heard about LangWatch to
                  customize your LangWatch experience.
                </Text>
                <VStack gap={4}>
                  <Field.Root invalid={!!errors.projectType}>
                    <Field.Label>Type of project?</Field.Label>
                    <RadioGroup
                      value={selectedValueProjectType || ""}
                      onValueChange={(e) => setValue("projectType", e.value)}
                    >
                      <HStack width="full" wrap="wrap">
                        {Object.entries(projectType).map(([value, icon]) => {
                          return (
                            <React.Fragment key={value}>
                              <CustomRadio
                                value={value}
                                registerProps={register("projectType", {
                                  required: "Please select a project type",
                                })}
                                selectedValue={selectedValueProjectType}
                                icon={icon}
                              />
                              {value === "Other" &&
                                selectedValueProjectType === "Other" && (
                                  <Input
                                    type="text"
                                    {...register("otherProjectType")}
                                    placeholder="Please specify"
                                  />
                                )}
                            </React.Fragment>
                          );
                        })}
                      </HStack>
                    </RadioGroup>
                    <Field.ErrorText>
                      {errors.projectType?.message}
                    </Field.ErrorText>
                  </Field.Root>
                  <Field.Root invalid={!!errors.howDidYouHearAboutUs}>
                    <Field.Label>How did you hear about us?</Field.Label>
                    <RadioGroup
                      value={selectedValueHowDidYouHearAboutUs || ""}
                      onValueChange={(e) =>
                        setValue("howDidYouHearAboutUs", e.value)
                      }
                    >
                      <HStack width="full" wrap="wrap">
                        {Object.entries(howDidYouHearAboutUs).map(
                          ([value, icon]) => {
                            return (
                              <React.Fragment key={value}>
                                <CustomRadio
                                  value={value}
                                  registerProps={register(
                                    "howDidYouHearAboutUs",
                                    {
                                      required:
                                        "Please select how you heard about us",
                                    }
                                  )}
                                  selectedValue={
                                    selectedValueHowDidYouHearAboutUs
                                  }
                                  icon={icon}
                                />
                                {value === "Other" &&
                                  selectedValueHowDidYouHearAboutUs ===
                                    "Other" && (
                                    <Input
                                      type="text"
                                      {...register("otherHowDidYouHearAboutUs")}
                                      placeholder="Please specify"
                                    />
                                  )}
                              </React.Fragment>
                            );
                          }
                        )}
                      </HStack>
                    </RadioGroup>
                    <Field.ErrorText>
                      {errors.howDidYouHearAboutUs?.message}
                    </Field.ErrorText>
                  </Field.Root>
                  <Separator />
                  <HStack width="full">
                    <Steps.PrevTrigger asChild>
                      <Button
                        variant="outline"
                        type="button"
                        disabled={createOrganization.isLoading}
                      >
                        Back
                      </Button>
                    </Steps.PrevTrigger>
                    <Button
                      colorPalette="orange"
                      type="submit"
                      disabled={
                        createOrganization.isLoading ||
                        createOrganization.isSuccess
                      }
                    >
                      {createOrganization.isLoading ||
                      createOrganization.isSuccess
                        ? "Loading..."
                        : "Next"}
                    </Button>
                  </HStack>
                </VStack>
              </Steps.Content>
            )}
          </Steps.Root>

          {createOrganization.error && <p>Something went wrong!</p>}
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
  registerProps: ReturnType<UseFormRegister<OrganizationFormData>>; // Updated type
  selectedValue: string;
  icon: React.ReactNode;
}) => {
  return (
    <Box as="label" key={value} marginTop={1}>
      <input
        type="radio"
        value={value}
        {...registerProps}
        checked={selectedValue === value} // Add checked prop
        style={{ display: "none" }} // Hide default radio button
      />
      <Box
        cursor="pointer"
        borderRadius="md"
        borderWidth="1px"
        boxShadow="sm"
        borderColor={selectedValue === value ? "orange.500" : "white.300"}
        _checked={{
          borderColor: "orange.500",
        }}
        _active={{ borderColor: "orange.600" }}
        px={5}
        py={3}
      >
        <HStack>
          {icon}
          <Text>{value}</Text>
        </HStack>
      </Box>
    </Box>
  );
};
