import {
  /* eslint-disable no-restricted-imports */
  Checkbox,
  Field,
  Icon,
  Input,
  VStack,
  /* eslint-enable no-restricted-imports */
} from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { useAnalytics } from "react-contextual-analytics";
import { Link } from "~/components/ui/link";
import { IconCheckboxCardGroup } from "../../../components/forms/IconCheckboxCardGroup";
import { IconRadioCardGroup } from "../../../components/forms/IconRadioCardGroup";
import { BasicInfoConditionalFields } from "../components/sections/BasicInfoConditionalFields";
import {
  desireItems,
  roleItems,
  usageStyleItems,
} from "../constants/onboarding-data";
import { useOnboardingFormContext } from "../contexts/form-context";
import {
  type CompanySize,
  type DesireType,
  type OnboardingFlowConfig,
  type OnboardingFormData,
  type OnboardingScreen,
  OnboardingScreenIndex,
  type RoleType,
  type SolutionType,
  type UsageStyle,
} from "../types/types";

// Module-scope screen components and their props
const OrganizationScreen: React.FC = () => {
  const { organizationName, agreement, setOrganizationName, setAgreement } =
    useOnboardingFormContext();
  const { emit } = useAnalytics();

  return (
    <VStack gap={5} align="stretch" w="full" minW="0">
      <Field.Root colorPalette="orange" w="full">
        <Input
          autoFocus
          aria-label="Organization name"
          size="lg"
          variant="outline"
          placeholder="Company or your name"
          borderRadius="10px"
          h="44px"
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
        />
        <Field.ErrorText />
      </Field.Root>

      <Field.Root colorPalette="orange">
        <Checkbox.Root
          size="sm"
          variant="subtle"
          checked={agreement}
          onCheckedChange={(details) => {
            const checked = details.checked === true;
            setAgreement(checked);
            emit("toggled", "terms_agreement", { checked });
          }}
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Checkbox.Label fontWeight="normal" fontSize="13px" color="fg.muted">
            {"I agree to the LangWatch "}
            <Link
              href="https://langwatch.ai/legal/terms-conditions"
              isExternal
              fontWeight="medium"
              variant="underline"
            >
              {"Terms of Service"}
              <Icon size="xs">
                <ExternalLink />
              </Icon>
            </Link>
          </Checkbox.Label>
        </Checkbox.Root>
      </Field.Root>
    </VStack>
  );
};

const BasicInfoScreen: React.FC = () => {
  const {
    usageStyle,
    phoneNumber,
    companySize,
    solutionType,
    setUsageStyle,
    setPhoneNumber,
    setPhoneHasValue,
    setPhoneIsValid,
    setCompanySize,
    setSolutionType,
  } = useOnboardingFormContext();
  const { emit } = useAnalytics();

  return (
    <VStack gap={0} align="stretch" w="full" minW="0">
      <Field.Root colorPalette="orange" w="full" minW="0" required>
        <IconRadioCardGroup<UsageStyle>
          items={usageStyleItems}
          value={usageStyle}
          onChange={(value) => {
            setUsageStyle(value);
            emit("selected", "usage_style", { value });
          }}
          direction="horizontal"
        />
      </Field.Root>

      <BasicInfoConditionalFields
        usageStyle={usageStyle}
        phoneNumber={phoneNumber}
        setPhoneNumber={setPhoneNumber}
        setPhoneHasValue={setPhoneHasValue}
        setPhoneIsValid={setPhoneIsValid}
        companySize={companySize}
        setCompanySize={setCompanySize}
        solutionType={solutionType}
        setSolutionType={setSolutionType}
      />
    </VStack>
  );
};

const DesiresScreen: React.FC = () => {
  const { selectedDesires, setDesires } = useOnboardingFormContext();
  const { emit } = useAnalytics();

  return (
    <IconCheckboxCardGroup<DesireType>
      items={desireItems}
      value={selectedDesires}
      onChange={(values) => {
        setDesires(values);
        emit("selected", "desires", { values, count: values.length });
      }}
    />
  );
};

const RoleScreen: React.FC = () => {
  const { role, setRole } = useOnboardingFormContext();
  const { emit } = useAnalytics();

  return (
    <Field.Root colorPalette="orange" w="full" minW="0">
      <IconRadioCardGroup<RoleType>
        items={roleItems}
        value={role}
        onChange={(value) => {
          setRole(value);
          emit("selected", "role", { value });
        }}
        direction="vertical"
      />
    </Field.Root>
  );
};

interface IntroScreensProps {
  flow: OnboardingFlowConfig;
}

export const useCreateWelcomeScreens = ({
  flow,
}: IntroScreensProps): OnboardingScreen[] => {
  const screensBase: Record<OnboardingScreenIndex, OnboardingScreen> = useMemo(
    () => ({
      [OnboardingScreenIndex.ORGANIZATION]: {
        id: "organization",
        required: true,
        heading: "Welcome aboard",
        subHeading: "Let's kick off by creating your organization",
        component: OrganizationScreen,
      },
      [OnboardingScreenIndex.BASIC_INFO]: {
        id: "basic-info",
        required: true,
        heading: "Let's tailor your experience",
        subHeading: "Tell us a bit about you and your team",
        component: BasicInfoScreen,
      },
      [OnboardingScreenIndex.DESIRES]: {
        id: "desires",
        required: false,
        heading: "Let's tailor your experience",
        subHeading: "What brings you to LangWatch?",
        component: DesiresScreen,
      },
      [OnboardingScreenIndex.ROLE]: {
        id: "role",
        required: false,
        heading: "Let's tailor your experience",
        subHeading: "What best describes you?",
        component: RoleScreen,
      },
    }),
    [],
  );

  return flow.visibleScreens.map((idx) => screensBase[idx]);
};
