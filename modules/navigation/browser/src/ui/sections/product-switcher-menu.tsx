import { Menu } from "@langwatch/design-system/menu";
import type { ButtonProps } from "@langwatch/design-system/primitives";
import { Box, Button, HStack, Portal, Text, VStack } from "@langwatch/design-system/primitives";
import { Check, ChevronsUpDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useLlmOpsProjectSlug } from "../../behavior/use-llm-ops-project-slug.ts";
import { useReachableProducts } from "../../behavior/use-reachable-products.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import {
  OPERATIONS_CONSOLE,
  PRODUCTS,
  type ProductDefinition,
  type ProductId,
  productById,
} from "../../model/products.ts";

/** The trigger reads as a raised pill on the top bar's gray. */
const productPillStyle = {
  variant: "ghost",
  textStyle: "bodySm",
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
  boxShadow: "0 1px 2px color-mix(in srgb, var(--chakra-colors-bg-scrim) 5%, transparent)",
  _hover: { backgroundColor: "bg.panel", borderColor: "border.emphasized" },
} satisfies ButtonProps;

function SwitcherEntry({
  icon: Icon,
  label,
  pitch,
  trailing,
}: {
  icon: LucideIcon;
  label: string;
  pitch: string;
  trailing?: ReactNode;
}) {
  return (
    <VStack align="start" gap={0.5} width="full">
      <HStack gap={2} width="full">
        <Icon size={13} color="var(--chakra-colors-fg-muted)" />
        <Text textStyle="label">{label}</Text>
        {trailing}
      </HStack>
      <Text textStyle="micro" color="fg.muted" paddingLeft="21px">
        {pitch}
      </Text>
    </VStack>
  );
}

/** Product dropdown: reachable products with pitch. Marks current product. Tracking removed. */
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
        <Button {...productPillStyle} aria-label="Switch product" data-tour="product-switcher">
          <ActiveIcon size={14} color="var(--chakra-colors-fg-muted)" />
          <Text truncate>{active.label}</Text>
          <ChevronsUpDown size={13} color="var(--chakra-colors-fg-subtle)" />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Content minWidth="280px" padding={1.5}>
          {options.map((product) => {
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
                <SwitcherEntry
                  icon={product.icon}
                  label={product.label}
                  pitch={product.pitch}
                  trailing={
                    isActive && (
                      <Box marginLeft="auto" display="flex">
                        <Check size={13} aria-label="Current product" />
                      </Box>
                    )
                  }
                />
              </Menu.Item>
            );
          })}
          {/* The operator console, for operators only: not a product, so it sits apart. */}
          {host.opsAccess().hasAccess ? (
            <>
              <Menu.Separator />
              <Menu.Item
                value="admin"
                data-testid="product-switcher-admin"
                onClick={() => host.navigate(OPERATIONS_CONSOLE.href)}
                paddingY={2}
                borderRadius="lg"
              >
                <SwitcherEntry {...OPERATIONS_CONSOLE} />
              </Menu.Item>
            </>
          ) : null}
        </Menu.Content>
      </Portal>
    </Menu.Root>
  );
}
