import type { ButtonProps } from "@chakra-ui/react";
import { Box, Button, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Menu } from "@langwatch/design-system/menu";
import { useLlmOpsProjectSlug } from "../../behavior/use-llm-ops-project-slug";
import { useReachableProducts } from "../../behavior/use-reachable-products";
import { useNavigationHost } from "../../model/navigation-host";
import {
  PRODUCTS,
  type ProductDefinition,
  type ProductId,
  productById,
} from "../../model/products";

/** The trigger reads as a raised pill on the top bar's gray. */
const productPillStyle = {
  variant: "ghost",
  fontSize: "13px",
  fontWeight: "medium",
  paddingX: 2.5,
  height: "28px",
  minWidth: 0,
  color: "fg",
  gap: 2,
  backgroundColor: "bg.panel",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "border",
  borderRadius: "lg",
  boxShadow: "0 1px 2px rgba(26, 26, 46, 0.05)",
  _hover: { backgroundColor: "bg.panel", borderColor: "border.emphasized" },
} satisfies ButtonProps;

/**
 * The product dropdown in the product-switcher top bar. Lists only the
 * products the user can reach, each with its pitch line so a first-time
 * visitor learns what it does, and marks the product the page belongs
 * to. Picking one opens that product's home.
 *
 * MOVED from `platform/app/src/features/navigation/shell/ProductSwitcherMenu.tsx`.
 * `trackEvent("navigation_product_switch", …)` did NOT travel, the line
 * `@langwatch/workflow-web` already drew for `trackEvent("workflow_create")`:
 * product analytics is the application's — which client, which consent, which
 * identity — and `platform/app`'s `utils/tracking` no longer exists to import
 * anyway. A port method the host could only answer with nothing would be worse
 * than its absence, so this records the loss instead of pretending to keep it.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
 */
export function ProductSwitcherMenu({ activeProductId }: { activeProductId: ProductId }) {
  const host = useNavigationHost();
  const { reachableProducts } = useReachableProducts();
  const projectSlug = useLlmOpsProjectSlug();

  const active = productById(activeProductId);
  const ActiveIcon = active.icon;
  const options = PRODUCTS.filter(
    (product) => product.id === activeProductId || reachableProducts.includes(product.id),
  );

  const openProduct = (product: ProductDefinition) => {
    if (product.id === activeProductId) return;
    const home = product.homeHref({ projectSlug });
    if (!home) return;
    host.navigate(home);
  };

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button {...productPillStyle} aria-label="Switch product">
          <ActiveIcon size={14} color="var(--chakra-colors-fg-muted)" />
          <Text truncate>{active.label}</Text>
          <ChevronsUpDown size={13} color="var(--chakra-colors-gray-400)" />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Content minWidth="280px" padding={1.5}>
          {options.map((product) => {
            const Icon = product.icon;
            const home = product.homeHref({ projectSlug });
            const isActive = product.id === activeProductId;
            return (
              <Menu.Item
                key={product.id}
                value={product.id}
                disabled={!isActive && !home}
                onClick={() => openProduct(product)}
                paddingY={2}
                borderRadius="lg"
                marginBottom="1px"
              >
                <VStack align="start" gap={0.5} width="full">
                  <HStack gap={2} width="full">
                    <Icon size={13} color="var(--chakra-colors-fg-muted)" />
                    <Text fontSize="13px" fontWeight="medium">
                      {product.label}
                    </Text>
                    {isActive && (
                      <Box marginLeft="auto" display="flex">
                        <Check size={13} aria-label="Current product" />
                      </Box>
                    )}
                  </HStack>
                  <Text fontSize="11px" lineHeight="short" color="fg.muted" paddingLeft="21px">
                    {product.pitch}
                  </Text>
                </VStack>
              </Menu.Item>
            );
          })}
        </Menu.Content>
      </Portal>
    </Menu.Root>
  );
}
