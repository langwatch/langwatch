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
import { AnimatePresence, motion } from "motion/react";
import { signOut } from "next-auth/react";
import { useAnalytics } from "react-contextual-analytics";
import { FullLogo } from "~/components/icons/FullLogo";
import { LightMode } from "~/components/ui/color-mode";
import { Tooltip } from "~/components/ui/tooltip";
import { OnboardingMeshBackground } from "../OnboardingMeshBackground";
import SpookyScarySkeleton from "../SpookyScarySkeleton";

const MotionBox = motion(Box);
const MotionCenter = motion(Center);
const MotionText = motion(Text);

interface OnboardingContainerProps extends React.PropsWithChildren {
  loading?: boolean;
  title: string;
  subTitle?: string;
  compressedHeader?: boolean;
  widthVariant?: "narrow" | "full";
  showBackButton?: boolean;
  onBack?: () => void;
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

  const titleBlock = (
    <VStack gap={1.5} align="center" textAlign="center" w="full">
      <AnimatePresence mode="wait">
        <MotionText
          key={title}
          textStyle="xl"
          fontWeight="600"
          color="fg.DEFAULT"
          letterSpacing="-0.01em"
          lineHeight="1.3"
          initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {title}
        </MotionText>
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {subTitle && (
          <MotionText
            key={subTitle}
            textStyle="sm"
            color="fg.muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {subTitle}
          </MotionText>
        )}
      </AnimatePresence>
    </VStack>
  );

  return (
    <Box w="full" minH="100dvh" bg="#FAFAFA" position="relative">
      <OnboardingMeshBackground />

      {showBackButton && onBack && (
        <MotionBox
          position="fixed"
          top={3}
          left={3}
          zIndex={99}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: "easeOut", delay: 0.2 }}
        >
          <Tooltip content="Back">
            <IconButton
              variant="ghost"
              size="sm"
              borderRadius="full"
              _hover={{ bg: "blackAlpha.50" }}
              onClick={onBack}
            >
              <ArrowLeft size={18} />
            </IconButton>
          </Tooltip>
        </MotionBox>
      )}

      <MotionBox
        position="fixed"
        top={3}
        right={3}
        zIndex={99}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.5 }}
      >
        <Tooltip content="Sign out">
          <IconButton
            variant="ghost"
            size="sm"
            borderRadius="full"
            color="fg.subtle"
            _hover={{ bg: "blackAlpha.50", color: "fg.DEFAULT" }}
            onClick={() => {
              emit("clicked", "sign_out");
              void signOut();
            }}
          >
            <LogOut size={16} />
          </IconButton>
        </Tooltip>
      </MotionBox>

      {skipHref && (
        <MotionBox
          position="fixed"
          right="24px"
          bottom="24px"
          zIndex={11}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.6 }}
        >
          <a
            href={skipHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 500,
              color: "#6B7280",
              background: "white",
              border: "1px solid rgba(0,0,0,0.08)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              textDecoration: "none",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            Continue to LangWatch
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </a>
        </MotionBox>
      )}

      {/* Logo */}
      <MotionCenter
        pt={compressedHeader ? "6vh" : "10vh"}
        pb={compressedHeader ? "2vh" : "4vh"}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <LightMode>
          <FullLogo width={150} />
        </LightMode>
      </MotionCenter>

      {/* Content */}
      <Container
        width="full"
        mx="auto"
        pb={16}
        maxW={
          isFullWidth
            ? { base: "100%", "2xl": "1440px" }
            : { base: "100%", md: "540px" }
        }
        px={isFullWidth ? { base: 5, md: 10 } : { base: 4, md: 0 }}
        {...(isFullWidth ? { fluid: true } : {})}
      >
        {isFullWidth ? (
          <VStack gap={8} align="stretch">
            {titleBlock}
            {loading ? <SpookyScarySkeleton loading /> : children}
          </VStack>
        ) : (
          <MotionBox
            bg="white"
            borderRadius="16px"
            border="1px solid"
            borderColor="rgba(0,0,0,0.06)"
            boxShadow="0 1px 2px rgba(0,0,0,0.03), 0 4px 16px rgba(0,0,0,0.02)"
            px={{ base: 5, md: 7 }}
            py={{ base: 6, md: 8 }}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: 0.5,
              ease: [0.16, 1, 0.3, 1],
              delay: 0.1,
            }}
          >
            <VStack gap={6} align="stretch" w="full">
              {titleBlock}
              {loading ? <SpookyScarySkeleton loading /> : children}
            </VStack>
          </MotionBox>
        )}
      </Container>
    </Box>
  );
};
