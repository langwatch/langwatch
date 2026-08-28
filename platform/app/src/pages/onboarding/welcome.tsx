import { UiDesignSystemShell } from "@langwatch/ui";
import { uiDesignSystem } from "@langwatch/ui/design-system";
import { WelcomeScreen } from "~/features/onboarding/screens/WelcomeScreen";

const OnboardingWelcome: React.FC = () => {
  return (
    <UiDesignSystemShell system={uiDesignSystem}>
      <WelcomeScreen />
    </UiDesignSystemShell>
  );
};

export default OnboardingWelcome;
