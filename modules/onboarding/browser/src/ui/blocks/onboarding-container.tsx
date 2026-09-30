import { Box, IconButton } from "@chakra-ui/react";
import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { Link } from "@langwatch/browser-host/link";
import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { ArrowLeft, ArrowRight, LogOut } from "lucide-react";
import { motion } from "motion/react";

import { useOnboardingHost } from "../../model/onboarding-host.ts";
import SpookyScarySkeleton from "../elements/spooky-scary-skeleton.tsx";

const MotionBox = motion.create(Box);

interface OnboardingContainerProps extends React.PropsWithChildren {
  /** The surface this chrome's events happened on, named by the flow above it. */
  boundary: string;
  loading?: boolean;
  title: string;
  subTitle?: string;
  /** `guided` is the guided variant's card width, wide enough for any company name. */
  widthVariant?: "narrow" | "guided" | "full";
  showBackButton?: boolean;
  onBack?: () => void;
  skipHref?: string;
}

/** The branded card size each step width stands at. */
const CARD_SIZES = { narrow: "wide", guided: "wide", full: "full" } as const;

export const OnboardingContainer: React.FC<OnboardingContainerProps> = ({
  children,
  boundary,
  title,
  subTitle,
  loading,
  widthVariant = "narrow",
  showBackButton,
  onBack,
  skipHref,
}) => {
  const analytics = useUiAnalytics();
  const host = useOnboardingHost();

  return (
    <BrandedCardPage>
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
              _hover={{ bg: "bg.muted" }}
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
            _hover={{ bg: "bg.muted", color: "fg" }}
            onClick={() => {
              analytics.track({ boundary, action: "clicked", name: "sign_out" });
              host.signOut();
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
              color: "fg",
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

      <BrandedCard title={title} intro={subTitle} size={CARD_SIZES[widthVariant]}>
        {loading ? <SpookyScarySkeleton loading /> : children}
      </BrandedCard>
    </BrandedCardPage>
  );
};
