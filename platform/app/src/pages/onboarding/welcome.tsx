import { Provider } from "~/components/ui/provider";
import { InvitationBeforeOnboarding } from "~/features/onboarding/components/InvitationBeforeOnboarding";
import { WelcomeScreen } from "~/features/onboarding/screens/WelcomeScreen";

const OnboardingWelcome: React.FC = () => {
  return (
    <Provider>
      <InvitationBeforeOnboarding>
        <WelcomeScreen />
      </InvitationBeforeOnboarding>
    </Provider>
  );
};

export default OnboardingWelcome;
