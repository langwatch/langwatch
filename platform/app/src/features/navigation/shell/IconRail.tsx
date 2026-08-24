import { Box, Text, VStack } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import { Settings as SettingsIcon } from "lucide-react";
import { LogoIcon } from "~/components/icons/LogoIcon";
import { Link } from "~/components/ui/link";
import { useRouter } from "~/utils/compat/next-router";
import { trackEvent } from "~/utils/tracking";
import { PRODUCTS, type ProductDefinition, type ProductId } from "../products";
import { useLlmOpsProjectSlug } from "../useLlmOpsProjectSlug";
import { useReachableProducts } from "../useReachableProducts";

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
      color={isActive ? "fg" : "fg.faint"}
      transition="all 0.15s ease-in-out"
      _hover={
        isActive
          ? undefined
          : { backgroundColor: "bg.panel/50", color: "fg.muted" }
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
        <Text
          fontSize="8.5px"
          fontWeight="semibold"
          lineHeight="1"
          letterSpacing="tight"
        >
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
  const router = useRouter();
  const { reachableProducts } = useReachableProducts();
  const projectSlug = useLlmOpsProjectSlug();

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
      backgroundColor="bg.rail"
      borderRightWidth="1px"
      borderRightStyle="solid"
      borderRightColor="border"
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
        <LogoIcon width={LOGO_HEIGHT * (38 / 52)} height={LOGO_HEIGHT} />
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

      <Box marginTop="auto" paddingBottom={1}>
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
