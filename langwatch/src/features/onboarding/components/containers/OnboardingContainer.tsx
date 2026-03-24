import {
  Box,
  Center,
  Container,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft, ArrowRight, LogOut } from "lucide-react";
import { Link } from "~/components/ui/link";
import { AnimatePresence, motion } from "motion/react";
import { signOut } from "next-auth/react";
import { useAnalytics } from "react-contextual-analytics";
import { FullLogo } from "~/components/icons/FullLogo";
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
    <Box w="full" minH="100dvh" bg="bg.page" position="relative" style={{ scrollbarGutter: "stable" }} overflowY="auto">
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
              aria-label="Go back"
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
            aria-label="Sign out"
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
          <Box
            asChild
            display="inline-flex"
            alignItems="center"
            gap="6px"
            px="16px"
            py="8px"
            borderRadius="10px"
            fontSize="13px"
            fontWeight="500"
            color="fg.muted"
            bg="bg.panel/70"
            backdropFilter="blur(12px)"
            border="1px solid"
            borderColor="border.subtle"
            boxShadow="sm"
            textDecoration="none"
            cursor="pointer"
            transition="all 0.25s ease"
            _hover={{
              bg: "bg.panel",
              color: "fg.DEFAULT",
              boxShadow: "md",
              transform: "translateY(-2px)",
              borderColor: "border.emphasized",
            }}
          >
            <Link href={skipHref}>
              Continue to LangWatch
              <ArrowRight size={14} />
            </Link>
          </Box>
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
        <FullLogo width={150} />
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
        <MotionBox
          bg="bg.panel"
          borderRadius="16px"
          border="1px solid"
          borderColor="border.subtle"
          boxShadow="sm"
          px={{ base: 5, md: isFullWidth ? 8 : 7 }}
          py={{ base: 6, md: 8 }}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            duration: 0.5,
            ease: [0.16, 1, 0.3, 1],
            delay: 0.1,
          }}
        >
          <VStack gap={isFullWidth ? 8 : 6} align="stretch" w="full">
            {titleBlock}
            {loading ? <SpookyScarySkeleton loading /> : children}
          </VStack>
        </MotionBox>
      </Container>
    </Box>
  );
};
