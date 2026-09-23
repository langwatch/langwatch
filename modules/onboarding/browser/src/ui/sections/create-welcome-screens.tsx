import { Alert, Checkbox, Field, Icon, Input, Text, VStack } from "@chakra-ui/react";
import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { Link } from "@langwatch/onboarding-browser-kit";
import { ExternalLink } from "lucide-react";
import type React from "react";
import { Suspense, useMemo } from "react";

import { LEGAL_LINKS } from "../../behavior/legal-links.ts";
import { onboardingApi } from "../../behavior/onboarding-api.ts";
import { desireItems, roleItems, usageStyleItems } from "../../behavior/onboarding-data.ts";
import {
  type DesireType,
  type OnboardingFlowConfig,
  type OnboardingScreen,
  OnboardingScreenIndex,
  type OnboardingScreenProps,
  type RoleType,
  type UsageStyle,
} from "../../behavior/types.ts";
import { extractJoinInsteadNames, formatJoinInsteadNames } from "../../model/join-instead.ts";
import { useOnboardingHost } from "../../model/onboarding-host.ts";
import { IconCheckboxCardGroup } from "../elements/forms/icon-checkbox-card-group.tsx";
import { IconRadioCardGroup } from "../elements/forms/icon-radio-card-group.tsx";
import { BasicInfoConditionalFields } from "./basic-info-conditional-fields.tsx";
import { useOnboardingFormContext } from "./form-context.tsx";
import { IntentSelectionScreen } from "./intent-selection-screen.tsx";

/**
 * "Acme is already here — join instead?" (D12). Nudged, never blocked: nothing
 * is disabled and the form below still completes. Renders nothing when nothing
 * is open to the reader's own verified address, which is most people.
 */
function JoinInsteadNotice({ lookup }: { lookup: unknown }) {
  const names = extractJoinInsteadNames(lookup);
  if (names.length === 0) return null;

  return (
    <Alert.Root status="info" width="full" size="sm" data-testid="join-instead-notice">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          <Text>
            {formatJoinInsteadNames(names)} {names.length === 1 ? "is" : "are"} already on LangWatch
            with your email domain.{" "}
            <Link href="/auth/join" variant="underline" fontWeight="medium">
              Join instead
            </Link>
            , or carry on and create a new one.
          </Text>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

// Module-scope screen components and their props
const OrganizationScreen: React.FC<OnboardingScreenProps> = ({ surface }) => {
  const { organizationName, agreement, setOrganizationName, setAgreement } =
    useOnboardingFormContext();
  const analytics = useUiAnalytics();
  // Answers only for the caller's OWN verified address, so no organization
  // name reaches the browser before the domain is proved.
  const joinLookup = onboardingApi.joinRequests.lookup.useQuery();
  const joinOffers = useOnboardingHost().joinOffers();

  return (
    <VStack gap={5} align="stretch" w="full" minW="0">
      {/* The decision comes first, as a screen: nudged, never blocked, and its
          way past lands back on this form with nothing lost. */}
      {joinOffers.map(({ key, JoinOffer }) => (
        <Suspense key={key} fallback={null}>
          <JoinOffer dismissLabel="Create a new organization instead" />
        </Suspense>
      ))}
      {/* For somebody who already declined for this domain: the sentence, not the screen. */}
      <JoinInsteadNotice lookup={joinLookup.data} />
      <Field.Root colorPalette="orange" w="full">
        <Input
          aria-label="Organization name"
          size="lg"
          variant="outline"
          placeholder="Company or your name"
          borderRadius="10px"
          h="44px"
          transition="padding 0.2s ease"
          _focus={{ px: 5 }}
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
        />
      </Field.Root>

      <Field.Root colorPalette="orange">
        <Checkbox.Root
          size="sm"
          variant="subtle"
          checked={agreement}
          onCheckedChange={(details) => {
            const checked = details.checked === true;
            setAgreement(checked);
            analytics.track({
              boundary: surface.boundary,
              action: "toggled",
              name: "terms_agreement",
              attributes: { ...surface.attributes, checked },
            });
          }}
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Checkbox.Label fontWeight="normal" fontSize="13px" color="fg.muted">
            {"I agree to the LangWatch "}
            <Link href={LEGAL_LINKS.terms.href} isExternal fontWeight="medium" variant="underline">
              {LEGAL_LINKS.terms.label}
              <Icon size="xs">
                <ExternalLink />
              </Icon>
            </Link>
            {" and "}
            <Link
              href={LEGAL_LINKS.privacy.href}
              isExternal
              fontWeight="medium"
              variant="underline"
            >
              {LEGAL_LINKS.privacy.label}
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

const BasicInfoScreen: React.FC<OnboardingScreenProps> = ({ surface }) => {
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
  const analytics = useUiAnalytics();

  return (
    <VStack gap={0} align="stretch" w="full" minW="0">
      <Field.Root colorPalette="orange" w="full" minW="0" required>
        <IconRadioCardGroup<UsageStyle>
          items={usageStyleItems}
          value={usageStyle}
          onChange={(value) => {
            setUsageStyle(value);
            analytics.track({
              boundary: surface.boundary,
              action: "selected",
              name: "usage_style",
              attributes: { ...surface.attributes, value },
            });
          }}
          direction="horizontal"
        />
      </Field.Root>

      <BasicInfoConditionalFields
        surface={surface}
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

const DesiresScreen: React.FC<OnboardingScreenProps> = ({ surface }) => {
  const { selectedDesires, setDesires } = useOnboardingFormContext();
  const analytics = useUiAnalytics();

  return (
    <IconCheckboxCardGroup<DesireType>
      items={desireItems}
      value={selectedDesires}
      onChange={(values) => {
        setDesires(values);
        analytics.track({
          boundary: surface.boundary,
          action: "selected",
          name: "desires",
          attributes: { ...surface.attributes, values, count: values.length },
        });
      }}
    />
  );
};

const RoleScreen: React.FC<OnboardingScreenProps> = ({ surface }) => {
  const { role, setRole } = useOnboardingFormContext();
  const analytics = useUiAnalytics();

  return (
    <Field.Root colorPalette="orange" w="full" minW="0">
      <IconRadioCardGroup<RoleType>
        items={roleItems}
        value={role}
        onChange={(value) => {
          setRole(value);
          analytics.track({
            boundary: surface.boundary,
            action: "selected",
            name: "role",
            attributes: { ...surface.attributes, value },
          });
        }}
        direction="vertical"
      />
    </Field.Root>
  );
};

/** The takeover phases draw themselves full-bleed, outside the card. */
const TakeoverScreen: React.FC = () => null;

interface IntroScreensProps {
  flow: OnboardingFlowConfig;
}

export const useCreateWelcomeScreens = ({ flow }: IntroScreensProps): OnboardingScreen[] => {
  const screensBase: Record<OnboardingScreenIndex, OnboardingScreen> = useMemo(
    () => ({
      [OnboardingScreenIndex.ORGANIZATION]: {
        id: "organization",
        required: true,
        heading: "Welcome aboard",
        subHeading: "Let's kick off by creating your organization",
        component: OrganizationScreen,
      },
      [OnboardingScreenIndex.INTENT]: {
        id: "intent",
        required: true,
        heading: "What do you want to do?",
        subHeading: "Pick your starting point. You can explore the rest anytime",
        component: IntentSelectionScreen,
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
      // The guided takeover gives the flow its indices; headings name the page.
      [OnboardingScreenIndex.HELLO]: {
        id: "hello",
        required: true,
        heading: "Hello",
        component: TakeoverScreen,
        widthVariant: "full",
      },
      [OnboardingScreenIndex.VALUE]: {
        id: "value",
        required: true,
        heading: "What to set up",
        component: TakeoverScreen,
        widthVariant: "full",
      },
      [OnboardingScreenIndex.PROVIDER]: {
        id: "provider",
        required: true,
        heading: "Connect a provider",
        component: TakeoverScreen,
        widthVariant: "full",
      },
    }),
    [],
  );

  return flow.visibleScreens.map((idx) => screensBase[idx]);
};
