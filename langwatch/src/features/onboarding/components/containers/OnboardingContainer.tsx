import {
  Box,
  Center,
  Container,
  VStack,
  Text,
  HStack,
  IconButton,
} from "@chakra-ui/react";
import { FullLogo } from "~/components/icons/FullLogo";
import { motion } from "motion/react";
import SpookyScarySkeleton from "../SpookyScarySkeleton";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";

const MotionCenter = motion(Center);
const MotionContainer = motion(Container);

interface OnboardingContainerProps extends React.PropsWithChildren {
  loading?: boolean;
  title: string;
  subTitle?: string;
}

export const OrganizationOnboardingContainer: React.FC<
  OnboardingContainerProps
> = ({ children, title, subTitle, loading }) => (
  <Box w="full" minH="100dvh" background="bg.subtle">
    <HStack position="fixed" top={2} right={2} zIndex={99}>
      <Tooltip content="Sign out">
        <IconButton
          variant="ghost"
          _hover={{ bg: "bg.emphasized" }}
          onClick={() => void signOut()}
        >
          <LogOut />
        </IconButton>
      </Tooltip>
    </HStack>

    <MotionCenter
      pt={"10vh"}
      pb={"5vh"}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <FullLogo width={175} />
    </MotionCenter>

    <MotionContainer
      mt={"10"}
      maxW={"700px"}
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


