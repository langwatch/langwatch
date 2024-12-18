import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  Heading,
  Input,
  Link,
  RadioGroup,
  Text,
  VStack,
  useRadio,
  useRadioGroup,
  useSteps,
  useToast,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import {
  Briefcase,
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
  Check,
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
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { usePublicEnv } from "../../hooks/usePublicEnv";
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
  const { getRootProps } = useRadioGroup({
    name: "usage",
    defaultValue: "company",
  });
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
    formState: { errors },
    reset: resetForm,
  } = useForm<OrganizationFormData>({
    mode: "onChange",
    defaultValues: {
      utmCampaign,
    },
  });
  const router = useRouter();
  const toast = useToast();
  const returnTo =
    typeof router.query.return_to === "string"
      ? router.query.return_to
      : undefined;

  const publicEnv = usePublicEnv();
  const isOnPrem = publicEnv.data?.IS_ONPREM;

  const createOrganization = api.organization.createAndAssign.useMutation();
  const apiContext = api.useContext();
  const steps = 3;
  const { activeStep, setActiveStep } = useSteps({
    index: 0,
    count: steps,
  });

  const onSubmit: SubmitHandler<OrganizationFormData> = (
    data: OrganizationFormData
  ) => {
    createOrganization.mutate(
      {
        orgName: data.organizationName,
        phoneNumber: data.phoneNumber,
        signUpData: data,
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
            `/onboarding/${createOrganization.data.teamSlug}/select${
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

  const group = getRootProps();

  const selectedValueUsage = watch("usage");
  const selectedValueSolution = watch("solution");
  const selectedValueCompanyType = watch("companyType");
  const selectedValueCompanySize = watch("companySize");
  const selectedValueProjectType = watch("projectType");
  const selectedValueHowDidYouHearAboutUs = watch("howDidYouHearAboutUs");

  const checkFirstStep = () => {
    if (
      getValues("organizationName") &&
      getValues("terms") &&
      getValues("usage")
    ) {
      setActiveStep(1);
    }
  };

  const checkSecondStep = () => {
    if (getValues("companyType") && getValues("companySize")) {
      setActiveStep(2);
    }
  };

  const checkThirdStep = () => {
    if (getValues("projectType") && getValues("howDidYouHearAboutUs")) {
      return true;
    }
  };

  return (
    <SetupLayout>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <VStack gap={4} alignItems="left">
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
          {activeStep === 0 && (
            <>
              <Heading as="h1" fontSize="x-large">
                Organization Details
              </Heading>
              <Text paddingBottom={4} fontSize="14px">
                Create the organization that will hold your projects on
                LangWatch
              </Text>
              <FormControl hidden={session.user.name !== undefined}>
                <FormLabel>Name</FormLabel>
                <Input type="text" disabled value={session.user.name ?? ""} />
              </FormControl>
              <FormControl hidden={session.user.email !== undefined}>
                <FormLabel>Email</FormLabel>
                <Input type="email" disabled value={session.user.email ?? ""} />
              </FormControl>
              <FormControl isInvalid={!!errors?.organizationName}>
                <FormLabel>Organization Name</FormLabel>
                <Input {...register("organizationName", { required: true })} />
                <FormErrorMessage>
                  Organization name is required
                </FormErrorMessage>
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

              {!isOnPrem && (
                <FormControl isInvalid={!!errors.usage}>
                  <FormLabel>How will you be using LangWatch?</FormLabel>

                  <RadioGroup
                    value={selectedValueUsage || ""}
                    onChange={(value) => setValue("usage", value)}
                  >
                    <HStack width="full">
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
                  <FormErrorMessage>{errors.usage?.message}</FormErrorMessage>
                </FormControl>
              )}
              {!isOnPrem && (
                <FormControl isInvalid={!!errors.solution}>
                  <FormLabel>What solution are you interested in?</FormLabel>
                  <RadioGroup
                    value={selectedValueSolution || ""}
                    onChange={(value) => setValue("solution", value)}
                  >
                    <HStack width="full">
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
                  <FormErrorMessage>
                    {errors.solution?.message}
                  </FormErrorMessage>
                </FormControl>
              )}
              <FormControl marginTop={4} isInvalid={!!errors?.terms}>
                <Checkbox {...register("terms", { required: true })}>
                  <Text fontSize={14}>
                    I agree with LangWatch{" "}
                    <Link
                      href="https://langwatch.ai/legal/terms-conditions"
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
                <FormErrorMessage>Please agree to terms</FormErrorMessage>
              </FormControl>

              {utmCampaign && (
                <FormControl>
                  <Text fontSize={14}>
                    You are signing up via the{" "}
                    <b>{titleCase(utmCampaign.replaceAll("-", " "))}</b> campaign
                  </Text>
                </FormControl>
              )}

              <Divider />
              <HStack width="full">
                <Button
                  colorScheme="orange"
                  type="submit"
                  disabled={createOrganization.isLoading}
                  onClick={() => {
                    if (!isOnPrem) {
                      checkFirstStep();
                    }
                  }}
                >
                  Next
                </Button>
              </HStack>
            </>
          )}
          {activeStep === 1 && (
            <>
              <Heading as="h1" fontSize="x-large">
                Company Details
              </Heading>
              <Text paddingBottom={4} fontSize="14px">
                Enter company type and team size to customize your LangWatch
                experience.
              </Text>
              <FormControl isInvalid={!!errors.companyType}>
                <FormLabel>Type of company?</FormLabel>
                <RadioGroup
                  value={selectedValueCompanyType || ""}
                  onChange={(value) => setValue("companyType", value)}
                >
                  <Box {...group}>
                    <HStack width="full" wrap="wrap">
                      {Object.entries(companyType).map(([value, icon]) => {
                        return (
                          <>
                            <CustomRadio
                              key={value}
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
                          </>
                        );
                      })}
                    </HStack>
                  </Box>
                </RadioGroup>
                <FormErrorMessage>
                  {errors.companyType?.message}
                </FormErrorMessage>
              </FormControl>
              <FormControl isInvalid={!!errors.companySize}>
                <FormLabel>Company size?</FormLabel>
                <RadioGroup
                  value={selectedValueCompanySize || ""}
                  onChange={(value) => setValue("companySize", value)}
                >
                  <Box {...group}>
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
                  </Box>
                </RadioGroup>
                <FormErrorMessage>
                  {errors.companySize?.message}
                </FormErrorMessage>
              </FormControl>
              <Divider />
              <HStack width="full">
                <Button
                  variant="outline"
                  // type="submit"
                  disabled={createOrganization.isLoading}
                  onClick={() => setActiveStep(0)}
                >
                  Back
                </Button>
                <Button
                  colorScheme="orange"
                  type="submit"
                  disabled={createOrganization.isLoading}
                  onClick={() => checkSecondStep()}
                >
                  {createOrganization.isLoading || createOrganization.isSuccess
                    ? "Loading..."
                    : "Next"}
                </Button>
              </HStack>
            </>
          )}

          {activeStep === 2 && (
            <>
              <Heading as="h1" fontSize="x-large">
                Additional Information
              </Heading>
              <Text paddingBottom={4} fontSize="14px">
                Enter your project type and how you heard about LangWatch to
                customize your LangWatch experience.
              </Text>
              <FormControl isInvalid={!!errors.projectType}>
                <FormLabel>Type of project?</FormLabel>
                <RadioGroup
                  value={selectedValueProjectType || ""}
                  onChange={(value) => setValue("projectType", value)}
                >
                  <Box {...group}>
                    <HStack width="full" wrap="wrap">
                      {Object.entries(projectType).map(([value, icon]) => {
                        return (
                          <>
                            <CustomRadio
                              key={value}
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
                          </>
                        );
                      })}
                    </HStack>
                  </Box>
                </RadioGroup>
                <FormErrorMessage>
                  {errors.projectType?.message}
                </FormErrorMessage>
              </FormControl>
              <FormControl isInvalid={!!errors.howDidYouHearAboutUs}>
                <FormLabel>How did you hear about us?</FormLabel>
                <RadioGroup
                  value={selectedValueHowDidYouHearAboutUs || ""}
                  onChange={(value) => setValue("howDidYouHearAboutUs", value)}
                >
                  <Box {...group}>
                    <HStack width="full" wrap="wrap">
                      {Object.entries(howDidYouHearAboutUs).map(
                        ([value, icon]) => {
                          return (
                            <>
                              <CustomRadio
                                key={value}
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
                            </>
                          );
                        }
                      )}
                    </HStack>
                  </Box>
                </RadioGroup>
                <FormErrorMessage>
                  {errors.howDidYouHearAboutUs?.message}
                </FormErrorMessage>
              </FormControl>
              <Divider />
              <HStack width="full">
                <Button
                  variant="outline"
                  disabled={createOrganization.isLoading}
                  onClick={() => setActiveStep(1)}
                >
                  Back
                </Button>
                <Button
                  colorScheme="orange"
                  type="submit"
                  disabled={
                    createOrganization.isLoading || createOrganization.isSuccess
                  }
                  onClick={() => {
                    checkThirdStep();
                  }}
                >
                  {createOrganization.isLoading || createOrganization.isSuccess
                    ? "Loading..."
                    : "Next"}
                </Button>
              </HStack>
            </>
          )}

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
    <Box as="label" key={value}>
      <input
        type="radio"
        value={value}
        {...registerProps}
        checked={selectedValue === value} // Add checked prop
        style={{ display: "none" }} // Hide default radio button
      />
      <Box
        cursor="pointer"
        borderWidth="1px"
        borderRadius="md"
        boxShadow="sm"
        borderColor={selectedValue === value ? "orange.500" : "gray.300"}
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
