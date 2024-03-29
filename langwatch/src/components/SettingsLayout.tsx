import { Link } from "@chakra-ui/next-js";
import { HStack, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { type PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";

export default function SettingsLayout({ children }: PropsWithChildren) {
  return (
    <DashboardLayout>
      <HStack align="start" width="full" height="full">
        <VStack
          align="start"
          background="white"
          paddingY={4}
          borderRightWidth="1px"
          borderColor="gray.300"
          fontSize="14px"
          minWidth="200px"
          height="full"
          spacing={0}
        >
          <MenuLink href="/settings">General Settings</MenuLink>
          <MenuLink href="/settings/projects">Projects</MenuLink>
          <MenuLink href="/settings/teams">Teams</MenuLink>
          <MenuLink href="/settings/members">Members</MenuLink>
          <MenuLink href="/settings/usage">Usage & Billing</MenuLink>
          <MenuLink href="/settings/subscription">Subscription</MenuLink>
        </VStack>
        {children}
      </HStack>
    </DashboardLayout>
  );
}
