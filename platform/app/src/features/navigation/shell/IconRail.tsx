import { Box, Text, VStack } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import { Settings as SettingsIcon } from "lucide-react";
import { LogoIcon } from "~/components/icons/LogoIcon";
import { Link } from "~/components/ui/link";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "~/utils/compat/next-router";
import { trackEvent } from "~/utils/tracking";
import { PRODUCTS, type ProductDefinition, type ProductId } from "../products";
import { useReachableProducts } from "../useReachableProducts";

export const ICON_RAIL_WIDTH = "64px";

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
      background={isActive ? "bg.surface" : "transparent"}
      boxShadow={isActive ? "xs" : undefined}
      color={isActive ? "fg" : "fg.muted"}
      transition="all 0.15s ease-in-out"
      _hover={
        isActive ? undefined : { background: "bg.surface/60", color: "fg" }
      }
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      title={title}
      onClick={onOpen}
    >
      {isActive && (
        <Box
          position="absolute"
          left="-5px"
          top="50%"
          transform="translateY(-50%)"
          width="3px"
          height="24px"
          borderRightRadius="full"
          background="fg"
        />
      )}
      <VStack gap={1}>
        <Icon size={19} strokeWidth={isActive ? 2.1 : 1.9} />
        <Text fontSize="8.5px" fontWeight="semibold" lineHeight="1">
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
  activeProductId: ProductId;
  isSettingsActive: boolean;
}) {
  const router = useRouter();
  const { reachableProducts } = useReachableProducts();
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const projectSlug = project && !project.isPersonal ? project.slug : null;

  const options = PRODUCTS.filter(
    (product) =>
      product.id === activeProductId || reachableProducts.includes(product.id),
  );

  const openProduct = (product: ProductDefinition) => {
    if (product.id === activeProductId && !isSettingsActive) return;
    const home = product.homeHref({ projectSlug });
    if (!home) return;
    trackEvent("navigation_product_switch", { product: product.id });
    void router.push(home);
  };

  return (
    <VStack
      as="nav"
      aria-label="Products"
      width={ICON_RAIL_WIDTH}
      minWidth={ICON_RAIL_WIDTH}
      minHeight="100vh"
      background="bg.muted"
      borderRightWidth="1px"
      borderRightStyle="solid"
      borderRightColor="border.muted"
      paddingY={3}
      gap={1}
      alignItems="center"
    >
      <Link
        href="/"
        aria-label="LangWatch"
        display="flex"
        alignItems="center"
        marginBottom={2}
      >
        <LogoIcon width={25 * 0.7} height={32 * 0.7} />
      </Link>

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

      <Box marginTop="auto">
        <RailTile
          icon={SettingsIcon}
          label="Settings"
          title="Settings"
          isActive={isSettingsActive}
          onOpen={() => void router.push("/settings")}
        />
      </Box>
    </VStack>
  );
}
