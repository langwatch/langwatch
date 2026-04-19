import { HStack, Text, chakra } from "@chakra-ui/react";
import React from "react";

interface ImpersonationBannerProps {
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

export const ImpersonationBanner = ({ user }: ImpersonationBannerProps) => {
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
        onClick={async (e: React.MouseEvent<HTMLAnchorElement>) => {
          e.preventDefault();
          const response = await fetch("/api/admin/impersonate", {
            method: "DELETE",
          });
          if (response.ok) {
            window.location.href = "/admin#/user";
          }
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
