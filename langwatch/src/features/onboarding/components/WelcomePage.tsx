import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { OrganizationOnboardingContainer } from "./OnboardingContainer";
import {
  Text,
  VStack,
  Field,
  Input,
  Button,
  Icon,
  Checkbox,
  Link,
} from "@chakra-ui/react";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useRouter } from "next/router";

export const WelcomePage: React.FC = () => {
  const { replace } = useRouter();
  const { isLoading: organizationIsLoading } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });

  const [organizationName, setOrganizationName] = useState("");
  const [agreement, setAgreement] = useState(false);

  const handleProceed = async () => {
    console.log("Organization name:", organizationName);

    await replace(`/onboarding/intro`);
  };

  return (
    <OrganizationOnboardingContainer loading={organizationIsLoading}>
      <VStack gap={4} align="stretch">
        <VStack gap={2} align="start">
          <Text textStyle={"2xl"} fontWeight={"bold"} color={"WindowText"}>
            {"Welcome Aboard 👋"}
          </Text>
          <Text textStyle={"md"} color={"WindowText"}>
            {"Let's kick off by creating your organization"}
          </Text>
        </VStack>

        <VStack gap={4} align="stretch">
          <Field.Root colorPalette="orange">
            <Input
              autoFocus
              variant="outline"
              placeholder={"My Laundry Startup"}
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
            />
            <Field.HelperText>
              {"If you're using LangWatch for yourself, you can use your own name."}
            </Field.HelperText>
            <Field.ErrorText />
          </Field.Root>

          <Field.Root colorPalette="orange">
            <Checkbox.Root
              size="sm"
              variant="outline"
              checked={agreement}
              onCheckedChange={(details) =>
                setAgreement(details.checked === true)
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Label fontWeight={"normal"}>
                {"I agree to the LangWatch "}
                <Link href="#" fontWeight={"bold"} variant="underline">
                  {"Terms of Service"}
                  <Icon size="xs">
                    <ExternalLink />
                  </Icon>
                </Link>
              </Checkbox.Label>
            </Checkbox.Root>
          </Field.Root>

          <Button
            w={"fit-content"}
            colorPalette="orange"
            variant="solid"
            onClick={() => void handleProceed()}
            disabled={!organizationName.trim() || !agreement}
          >
            {"Create"}
          </Button>
        </VStack>
      </VStack>
    </OrganizationOnboardingContainer>
  );
};
