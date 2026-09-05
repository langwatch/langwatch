import { chakra, HStack, Text } from "@chakra-ui/react";
import type React from "react";

export interface ImpersonationBannerProps {
  /**
   * What "Stop" does. The banner draws the state and names the action; ending
   * the impersonation is a session write, so the mounting feature performs it
   * and decides where the reader lands afterwards.
   */
  onStop: () => void;
  user: {
    name?: string | null;
    email?: string | null;
    impersonator?: {
      id: string;
      name?: string | null;
      email?: string | null;
    };
  };
}

export const ImpersonationBanner = ({ onStop, user }: ImpersonationBannerProps) => {
  if (!user.impersonator) return null;

  return (
    <HStack
      fontSize="12px"
      fontWeight="bold"
      color="white"
      background="linear-gradient(135deg, #3182CE, #2B6CB0)"
      border="1px solid"
      borderColor="blue.400"
      borderRadius="full"
      height="32px"
      paddingX={3}
      gap={2}
      flexShrink={0}
    >
      <Text fontSize="12px" lineClamp={1}>
        Impersonating {user.name ?? user.email ?? "unknown user"}
      </Text>
      <chakra.a
        href="#"
        onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
          e.preventDefault();
          onStop();
        }}
        fontSize="11px"
        fontWeight="bold"
        color="white"
        background="whiteAlpha.300"
        borderRadius="full"
        paddingX={2}
        paddingY="2px"
        cursor="pointer"
        _hover={{ background: "whiteAlpha.400" }}
      >
        Stop
      </chakra.a>
    </HStack>
  );
};
