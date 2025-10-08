import { Provider as ChakraProvider } from "~/components/ui/provider";
import { WelcomePage } from "~/features/onboarding/components/WelcomePage";

const OnboardingWelcome: React.FC = () => {
  return (
    <ChakraProvider>
      <WelcomePage />
    </ChakraProvider>
  );
};

export default OnboardingWelcome;
