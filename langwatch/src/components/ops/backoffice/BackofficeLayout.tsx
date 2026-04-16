import { Container, HStack, VStack } from "@chakra-ui/react";
import { type PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

/**
 * Two-column Backoffice layout — left menu + right content panel, mirroring
 * SettingsLayout's structure so the new OPS Backoffice module looks and feels
 * like Settings (per the design direction in #3245).
 *
 * The left menu is a flat list of admin resources — matches the resource set
 * the old /admin (react-admin) surface exposed, exactly as the user requested.
 */
export default function BackofficeLayout({ children }: PropsWithChildren) {
  return (
    <DashboardLayout compactMenu>
      <PageLayout.Header>
        <PageLayout.Heading>Backoffice</PageLayout.Heading>
      </PageLayout.Header>
      <HStack align="start" width="full" height="full">
        <VStack
          align="start"
          paddingX={2}
          paddingY={4}
          fontSize="14px"
          minWidth="220px"
          height="full"
          gap={1}
        >
          <MenuLink href="/ops/backoffice/users">Users</MenuLink>
          <MenuLink href="/ops/backoffice/organizations">
            Organizations
          </MenuLink>
          <MenuLink href="/ops/backoffice/projects">Projects</MenuLink>
          <MenuLink href="/ops/backoffice/subscriptions">
            Subscriptions
          </MenuLink>
          <MenuLink href="/ops/backoffice/organization-features">
            Organization Features
          </MenuLink>
        </VStack>
        <Container maxWidth="1280px" padding={4} paddingBottom={16}>
          {children}
        </Container>
      </HStack>
    </DashboardLayout>
  );
}
