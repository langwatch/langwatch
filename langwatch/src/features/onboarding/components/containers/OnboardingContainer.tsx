import {
  Box,
  Center,
  Container,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft, LogOut } from "lucide-react";
import { motion } from "motion/react";
import { signOut } from "next-auth/react";
import { useAnalytics } from "react-contextual-analytics";
import { FullLogo } from "~/components/icons/FullLogo";
import { Tooltip } from "~/components/ui/tooltip";
import SpookyScarySkeleton from "../SpookyScarySkeleton";

const MotionCenter = motion(Center);
const MotionContainer = motion(Container);

interface OnboardingContainerProps extends React.PropsWithChildren {
  loading?: boolean;
  title: string;
  subTitle?: string;

  /**
   * Whether to have reduced padding above/below the header for more vertically dense screens.
   */
  compressedHeader?: boolean;
  /**
   * Controls the maximum width of the container content. Single Responsibility: layout width.
   */
  widthVariant?: "narrow" | "full";
  /**
   * Whether to show the back button. Single Responsibility: navigation control.
   */
  showBackButton?: boolean;
  /**
   * Callback when back button is clicked. Single Responsibility: back navigation handler.
   */
  onBack?: () => void;
}

export const OnboardingContainer: React.FC<OnboardingContainerProps> = ({
  children,
  title,
  subTitle,
  loading,
  compressedHeader,
  widthVariant = "narrow",
  showBackButton,
  onBack,
}) => {
  const { emit } = useAnalytics();
  const isFullWidth = widthVariant === "full";
  const containerWidthProps = isFullWidth
    ? {
        maxW: { base: "100%", "2xl": "1440px" },
        px: { base: 4, md: 10 },
      }
    : {
        maxW: { base: "100%", md: "720px", xl: "840px" },
        px: { base: 4, md: 8 },
      };

  return (
    <Box w="full" minH="100dvh" background="bg.subtle">
      {showBackButton && onBack && (
        <HStack position="fixed" top={2} left={2} zIndex={99}>
          <Tooltip content="Back">
            <IconButton
              variant="ghost"
              _hover={{ bg: "bg.emphasized" }}
              onClick={onBack}
            >
              <ArrowLeft />
            </IconButton>
          </Tooltip>
        </HStack>
      )}

      <HStack position="fixed" top={2} right={2} zIndex={99}>
        <Tooltip content="Sign out">
          <IconButton
            variant="ghost"
            _hover={{ bg: "bg.emphasized" }}
            onClick={() => {
              emit("clicked", "sign_out");
              void signOut();
            }}
          >
            <LogOut />
          </IconButton>
        </Tooltip>
      </HStack>

      <MotionCenter
        pt={compressedHeader ? "5vh" : "10vh"}
        pb={compressedHeader ? "2.5vh" : "5vh"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <FullLogo width={175} />
      </MotionCenter>

      <MotionContainer
        mt={"10"}
        width="full"
        mx="auto"
        {...containerWidthProps}
        {...(isFullWidth ? { fluid: true } : {})}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <VStack gap={4} align="stretch">
          <VStack gap={0} align="start">
            <Text textStyle={"2xl"} fontWeight={"bold"} color={"WindowText"}>
              {title}
            </Text>
            {subTitle && (
              <Text textStyle={"md"} color={"WindowText"}>
                {subTitle}
              </Text>
            )}
          </VStack>

          {loading && <SpookyScarySkeleton loading={loading} />}
          {!loading && children}
        </VStack>
      </MotionContainer>
    </Box>
  );
};
