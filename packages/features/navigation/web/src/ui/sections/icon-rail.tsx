/**
 * The icon-rail mode's product column.
 *
 * Moved from `platform/app/src/features/navigation/shell/IconRail.tsx`. The
 * logo anchor survives the move as a real anchor: the chrome section of the
 * manifest recorded that a governed package could not keep it, because
 * `frontend-ui-boundaries` forbids `react-router` by name — the package's own
 * {@link NavigationLink} is the answer that was missing then, and a middle
 * click still opens a new tab.
 *
 * `trackEvent("navigation_product_switch")` did not travel, the same line
 * `@langwatch/workflow-web` drew for `trackEvent("workflow_create")`: product
 * analytics is the application's, and `platform/app/src/utils/tracking` no
 * longer exists to import in any case.
 *
 * Spec: specs/navigation/icon-rail-navigation.feature
 */

import { Box, Text, VStack } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import { Settings as SettingsIcon } from "lucide-react";
import { useLlmOpsProjectSlug } from "../../behavior/use-llm-ops-project-slug";
import { useReachableProducts } from "../../behavior/use-reachable-products";
import { useNavigationHost } from "../../model/navigation-host";
import { PRODUCTS, type ProductDefinition, type ProductId } from "../../model/products";
import { LogoIcon } from "../elements/logo-icon";
import { NavigationLink } from "../elements/navigation-link";

export const ICON_RAIL_WIDTH = "64px";

const LOGO_HEIGHT = 30;

function RailTile({
  icon: Icon,
  label,
  title,
  isActive,
  onOpen,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  isActive: boolean;
  onOpen: () => void;
}) {
  return (
    <Box
      as="button"
      position="relative"
      width="54px"
      paddingY={2}
      borderRadius="xl"
      cursor="pointer"
      backgroundColor={isActive ? "bg.panel" : "transparent"}
      boxShadow={isActive ? "0 1px 3px rgba(26, 26, 46, 0.09)" : undefined}
      color={isActive ? "fg" : "gray.400"}
      transition="all 0.15s ease-in-out"
      _hover={
        isActive ? undefined : { backgroundColor: "bg.panel/50", color: "fg.muted" }
      }
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      title={title}
      onClick={onOpen}
    >
      {isActive && (
        <Box
          position="absolute"
          left="-7px"
          top="50%"
          transform="translateY(-50%)"
          width="3px"
          height="24px"
          borderRightRadius="full"
          background="fg/70"
        />
      )}
      <VStack gap={1}>
        <Icon size={19} strokeWidth={isActive ? 2.1 : 1.9} />
        <Text fontSize="8.5px" fontWeight="semibold" lineHeight="1" letterSpacing="tight">
          {label}
        </Text>
      </VStack>
    </Box>
  );
}

/**
 * The icon-rail mode's product column: a darker full-height rail with
 * the logo, one tile per reachable product (tiny label under the icon,
 * white active tile with a side indicator), and Settings pinned to the
 * bottom. Picking a tile opens that product's home; the product
 * dropdown disappears from the top bar in this mode.
 *
 * Spec: specs/navigation/icon-rail-navigation.feature
 */
export function IconRail({
  activeProductId,
  isSettingsActive,
}: {
  activeProductId: ProductId | null;
  isSettingsActive: boolean;
}) {
  const host = useNavigationHost();
  const { reachableProducts } = useReachableProducts();
  const projectSlug = useLlmOpsProjectSlug();

  const options = PRODUCTS.filter(
    (product) => product.id === activeProductId || reachableProducts.includes(product.id),
  );

  const openProduct = (product: ProductDefinition) => {
    if (product.id === activeProductId && !isSettingsActive) return;
    const home = product.homeHref({ projectSlug });
    if (!home) return;
    host.navigate(home);
  };

  return (
    <VStack
      as="nav"
      aria-label="Products"
      width={ICON_RAIL_WIDTH}
      minWidth={ICON_RAIL_WIDTH}
      minHeight="100vh"
      backgroundColor="bg.rail"
      borderRightWidth="1px"
      borderRightStyle="solid"
      borderRightColor="border"
      paddingY={3}
      gap={1}
      alignItems="center"
    >
      <NavigationLink
        href="/"
        aria-label="LangWatch"
        display="flex"
        alignItems="center"
        marginBottom={2}
      >
        <LogoIcon width={LOGO_HEIGHT * (38 / 52)} height={LOGO_HEIGHT} />
      </NavigationLink>

      {options.map((product) => (
        <RailTile
          key={product.id}
          icon={product.icon}
          label={product.label}
          title={`${product.label}: ${product.pitch}`}
          isActive={product.id === activeProductId && !isSettingsActive}
          onOpen={() => openProduct(product)}
        />
      ))}

      <Box marginTop="auto" paddingBottom={1}>
        <RailTile
          icon={SettingsIcon}
          label="Settings"
          title="Settings"
          isActive={isSettingsActive}
          onOpen={() => host.navigate("/settings")}
        />
      </Box>
    </VStack>
  );
}
