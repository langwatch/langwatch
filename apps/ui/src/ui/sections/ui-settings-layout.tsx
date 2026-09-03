/**
 * The settings chrome, as `apps/ui` serves it.
 *
 * Harvested from `platform/app/src/components/SettingsLayout.tsx`: the same
 * collapsible menu, the same entries, the same gates and the same content
 * container. A copy rather than a repoint — the platform component stays for
 * the twenty-odd settings pages that have not moved, and dies with the last of
 * them.
 *
 * WHY IT IS HERE AND NOT IN A PACKAGE. It is host chrome shared by every
 * settings family, so no one family's web package can own it, and a package may
 * not import `apps/ui` in any case. A settings feature's routes section wraps
 * its screen in this; the screen itself stays layout-free, exactly as the
 * platform pages composed it.
 *
 * WHAT DRIVES IT is the capability layer and nothing else: `hasPermission` and
 * both operator grants come off the session port, and the plan tier and the
 * membership role off `useUiSettingsMenuFacts`, which reads them on this
 * application's transport under tRPC's own cache keys.
 *
 * THE MENU DOES NOT LOSE ENTRIES WHEN A FAMILY LEAVES. Every item is an href,
 * and an href is not a loader: the addresses of the pages still served by
 * `platform/app` are unchanged and its router still answers them. What the menu
 * shows is therefore independent of which half of the product renders the page.
 * `model/ui-settings-menu.ts` holds the list so that stays a test rather than a
 * promise.
 *
 * NOT CARRIED: `SettingsLayout`'s `isSubscription` prop, which hid the sidebar
 * for the one billing page. That page has not moved, and a layout option with
 * no caller is a promise nothing keeps.
 */

import { Box, Collapsible, Container, HStack, Link, Spacer, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import {
  useEffect,
  useState,
  type ComponentType,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { Link as RouterLink, useLocation } from "react-router";
import { useUiCapabilities } from "../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../behavior/ui-organization-facts";
import {
  isUiSettingsMenuGroupActive,
  isUiSettingsMenuItemActive,
  uiSettingsMenu,
  type UiSettingsMenuGroup,
  type UiSettingsMenuItem,
} from "../../model/ui-settings-menu";

/** The grant that opens the operator workspace. The ops family's reading. */
export const UI_OPS_VIEW_PERMISSION = "ops:view";

/** The narrower grant that opens the Backoffice, decoupled from the workspace. */
export const UI_OPS_MANAGE_PERMISSION = "ops:manage";

function SettingsMenuLink({ item, pathname }: { item: UiSettingsMenuItem; pathname: string }) {
  const selected = isUiSettingsMenuItemActive({ item, pathname });
  return (
    <Link
      asChild
      paddingX={4}
      paddingY={1}
      width="full"
      position="relative"
      borderRadius="lg"
      background={selected ? "bg.muted" : "transparent"}
      _hover={{ background: "bg.muted" }}
    >
      <RouterLink to={item.href}>
        <HStack width="full" gap={2}>
          <Text>{item.label}</Text>
          <Spacer />
        </HStack>
      </RouterLink>
    </Link>
  );
}

function SettingsNavSection({
  label,
  isActive,
  children,
}: PropsWithChildren<{ label: string; isActive: boolean }>) {
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  return (
    <Collapsible.Root open={open} onOpenChange={(details) => setOpen(details.open)} width="full">
      <VStack align="start" width="full" gap={0}>
        <Collapsible.Trigger asChild>
          <Box as="button" width="full" cursor="pointer">
            <HStack
              width="full"
              px={4}
              py={1}
              color={isActive ? "fg" : "fg.muted"}
              _hover={{ color: "fg" }}
            >
              <Text
                fontSize="xs"
                fontWeight="semibold"
                textTransform="uppercase"
                letterSpacing="wider"
              >
                {label}
              </Text>
              <Box
                ml="auto"
                transform={open ? "rotate(0deg)" : "rotate(-90deg)"}
                transition="transform 0.15s ease-in-out"
              >
                <ChevronDown size={12} />
              </Box>
            </HStack>
          </Box>
        </Collapsible.Trigger>
        {/* Collapsible.Content animates height open/closed; the manual
            `{open && …}` it replaced snapped with no transition. */}
        <Collapsible.Content style={{ width: "100%" }}>
          <VStack align="start" width="full" gap={1} pl={2} pt={1}>
            {children}
          </VStack>
        </Collapsible.Content>
      </VStack>
    </Collapsible.Root>
  );
}

export function UiSettingsLayout({ children }: { children: ReactNode }) {
  const { session } = useUiCapabilities();
  const { pathname } = useLocation();
  const { isEnterprise, isPlanLoading, isLiteMember, isSaaS } = useUiOrganizationFacts();

  const menu = uiSettingsMenu({
    hasPermission: (permission) => session.hasPermission(permission),
    isSaaS,
    // The enterprise entries render while the plan is still arriving, so a
    // reader on the enterprise plan never watches four links appear a beat late.
    showEnterpriseNav: isPlanLoading || isEnterprise,
    isLiteMember,
    hasOpsAccess: session.hasPermission(UI_OPS_VIEW_PERMISSION),
    isOpsAdmin: session.hasPermission(UI_OPS_MANAGE_PERMISSION),
  });

  return (
    <HStack align="start" width="full" height="full" gap={0}>
      <VStack
        align="start"
        paddingX={2}
        paddingY={4}
        fontSize="14px"
        minWidth="200px"
        height="full"
        overflowY="auto"
        flexShrink={0}
        gap={2}
      >
        {menu.top.map((item) => (
          <SettingsMenuLink key={item.href} item={item} pathname={pathname} />
        ))}
        {menu.groups.map((group: UiSettingsMenuGroup) => (
          <SettingsNavSection
            key={group.label}
            label={group.label}
            isActive={isUiSettingsMenuGroupActive({ group, pathname })}
          >
            {group.items.map((item) => (
              <SettingsMenuLink key={item.href} item={item} pathname={pathname} />
            ))}
          </SettingsNavSection>
        ))}
      </VStack>
      <Container
        maxWidth="1280px"
        padding={4}
        paddingBottom={16}
        height="full"
        overflowY="auto"
        flex={1}
      >
        {children}
      </Container>
    </HStack>
  );
}

/** Wraps a settings screen in the settings chrome. */
export function withUiSettingsLayout<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Wrapped = (props: P) => (
    <UiSettingsLayout>
      <Screen {...props} />
    </UiSettingsLayout>
  );
  Wrapped.displayName = `withUiSettingsLayout(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Wrapped;
}
