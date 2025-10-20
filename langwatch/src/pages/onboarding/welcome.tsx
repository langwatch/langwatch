import { Provider } from "~/components/ui/provider";
import { WelcomeScreen } from "~/features/onboarding/screens/WelcomeScreen";

const OnboardingWelcome: React.FC = () => {
  return (
    <Provider>
      <WelcomeScreen />
    </Provider>
  );
};

export default OnboardingWelcome;
