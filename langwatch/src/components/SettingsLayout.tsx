import { Link } from "@chakra-ui/next-js";
import { HStack, VStack, type ComponentWithAs } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { type PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";

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
        </VStack>
        {children}
      </HStack>
    </DashboardLayout>
  );
}

export const MenuLink = ({
  href,
  children,
}: PropsWithChildren<{ href: string }>) => {
  const router = useRouter();
  const selected =
    href == "/settings"
      ? router.pathname === href
      : router.pathname.startsWith(href);

  return (
    <Link
      href={href}
      paddingX={4}
      paddingY={2}
      width="full"
      position="relative"
      _hover={{ background: "gray.50" }}
      _before={{
        content: '""',
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: "4px",
        background: selected ? "orange.400" : "transparent",
      }}
    >
      {children}
    </Link>
  );
};
