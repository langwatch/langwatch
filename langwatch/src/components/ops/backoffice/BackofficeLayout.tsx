import { Box, Container, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type PropsWithChildren, useEffect, useId, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { usePathname } from "~/utils/compat/next-navigation";

/**
 * Collapsible sidebar section — visually matches SettingsLayout so Backoffice
 * inherits the same menu feel (uppercase muted headers, chevron, active group
 * auto-expanded).
 *
 * Uses `<button>` semantics on the header so the control is keyboard-operable
 * (Enter/Space toggle), plus `aria-expanded` / `aria-controls` so screen
 * readers announce the collapsible state.
 */
function NavSection({
  label,
  paths,
  children,
}: PropsWithChildren<{ label: string; paths: string[] }>) {
  const pathname = usePathname();
  const isActive = paths.some((p) => pathname?.startsWith(p));
  const [open, setOpen] = useState(isActive);
  const panelId = `backoffice-nav-${useId()}`;

  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  return (
    <VStack align="start" width="full" gap={0}>
      <Box
        as="button"
        width="full"
        px={4}
        py={1}
        color="fg.muted"
        background="transparent"
        border="none"
        textAlign="left"
        cursor="pointer"
        _hover={{ color: "fg" }}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <HStack width="full">
          <Text
            fontSize="xs"
            fontWeight="semibold"
            textTransform="uppercase"
            letterSpacing="wider"
          >
            {label}
          </Text>
          <Box ml="auto">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </Box>
        </HStack>
      </Box>
      {open && (
        <VStack id={panelId} align="start" width="full" gap={1} pl={2}>
          {children}
        </VStack>
      )}
    </VStack>
  );
}

/**
 * Two-column Backoffice layout — left menu + right content panel, mirroring
 * SettingsLayout's structure so the new OPS Backoffice module looks and feels
 * like Settings (per the design direction in #3245).
 *
 * The left menu lists the admin resources currently exposed by /admin:
 * Users, Organizations, Projects (Identity); Subscriptions (Billing);
 * Organization Features (Features).
 *
 * Callers are responsible for the admin-only gate upstream (see
 * ops/backoffice page which wraps AdminApp inside this layout).
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
          minWidth="200px"
          height="full"
          gap={2}
        >
          <NavSection
            label="Identity"
            paths={[
              "/ops/backoffice/user",
              "/ops/backoffice/organization",
              "/ops/backoffice/project",
            ]}
          >
            <MenuLink href="/ops/backoffice/user" includePath="/user">
              Users
            </MenuLink>
            <MenuLink
              href="/ops/backoffice/organization"
              includePath="/organization"
            >
              Organizations
            </MenuLink>
            <MenuLink href="/ops/backoffice/project" includePath="/project">
              Projects
            </MenuLink>
          </NavSection>

          <NavSection
            label="Billing"
            paths={["/ops/backoffice/subscription"]}
          >
            <MenuLink
              href="/ops/backoffice/subscription"
              includePath="/subscription"
            >
              Subscriptions
            </MenuLink>
          </NavSection>

          <NavSection
            label="Features"
            paths={["/ops/backoffice/organizationFeature"]}
          >
            <MenuLink
              href="/ops/backoffice/organizationFeature"
              includePath="/organizationFeature"
            >
              Organization Features
            </MenuLink>
          </NavSection>
        </VStack>
        <Container maxWidth="1280px" padding={4} paddingBottom={16}>
          {children}
        </Container>
      </HStack>
    </DashboardLayout>
  );
}
