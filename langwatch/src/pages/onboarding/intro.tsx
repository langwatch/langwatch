import { Provider as ChakraProvider } from "~/components/ui/provider";
import { IntroPage } from "~/features/onboarding/components/IntroPage";

const IntroOnboarding: React.FC = () => {
  return (
    <ChakraProvider>
      <IntroPage />
    </ChakraProvider>
  );
};

export default IntroOnboarding;
