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
import { LightMode } from "~/components/ui/color-mode";
import { Tooltip } from "~/components/ui/tooltip";
import { OnboardingMeshBackground } from "../OnboardingMeshBackground";
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
  /**
   * If provided, shows a "Skip" link in the top-right nav to skip onboarding.
   */
  skipHref?: string;
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
  skipHref,
}) => {
  const { emit } = useAnalytics();
  const isFullWidth = widthVariant === "full";
  const containerWidthProps = isFullWidth
    ? {
        maxW: { base: "100%", "2xl": "1440px" },
        px: { base: 5, md: 10 },
      }
    : {
        maxW: { base: "100%", md: "560px", xl: "640px" },
        px: { base: 4, md: 8 },
      };

  return (
    <Box w="full" minH="100dvh" background="bg.subtle" position="relative">
      <OnboardingMeshBackground />
      {showBackButton && onBack && (
        <HStack position="fixed" top={3} left={3} zIndex={99}>
          <Tooltip content="Back">
            <IconButton
              variant="ghost"
              size="sm"
              borderRadius="full"
              _hover={{ bg: "bg.muted" }}
              onClick={onBack}
            >
              <ArrowLeft size={18} />
            </IconButton>
          </Tooltip>
        </HStack>
      )}

      <HStack position="fixed" top={3} right={3} zIndex={99}>
        <Tooltip content="Sign out">
          <IconButton
            variant="ghost"
            size="sm"
            borderRadius="full"
            _hover={{ bg: "bg.muted" }}
            onClick={() => {
              emit("clicked", "sign_out");
              void signOut();
            }}
          >
            <LogOut size={18} />
          </IconButton>
        </Tooltip>
      </HStack>

      {skipHref && (
        <Box position="fixed" right="24px" bottom="24px" zIndex={11}>
          <a
            href={skipHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "9999px",
              fontSize: "13px",
              fontWeight: 500,
              color: "#51676C",
              background: "white",
              border: "1px solid #E0E2E6",
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            Continue to LangWatch
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </a>
        </Box>
      )}

      <MotionCenter
        pt={compressedHeader ? "6vh" : "10vh"}
        pb={compressedHeader ? "3vh" : "5vh"}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <LightMode>
          <FullLogo width={175} />
        </LightMode>
      </MotionCenter>

      <MotionContainer
        width="full"
        mx="auto"
        mt={"10"}
        pb={16}
        {...containerWidthProps}
        {...(isFullWidth ? { fluid: true } : {})}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
      >
        <VStack gap={8} align="stretch">
          <VStack gap={1} align="center" textAlign="center">
            <Text
              textStyle="2xl"
              fontWeight="bold"
              color="fg.DEFAULT"
              letterSpacing="-0.02em"
              lineHeight="1.2"
            >
              {title}
            </Text>
            {subTitle && (
              <Text textStyle="md" color="fg.muted" maxW="400px">
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
