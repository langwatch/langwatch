/** Icon-rail product column (moved from platform/app; uses NavigationLink). */

import { IconRail, IconRailTile } from "@langwatch/design-system/app-shell";
import { LogoIcon } from "@langwatch/design-system/logo-icon";
import { Settings as SettingsIcon } from "lucide-react";

import { useLlmOpsProjectSlug } from "../../behavior/use-llm-ops-project-slug.ts";
import { useReachableProducts } from "../../behavior/use-reachable-products.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import { PRODUCTS, type ProductDefinition, type ProductId } from "../../model/products.ts";
import { NavigationLink } from "../elements/navigation-link.tsx";

const LOGO_HEIGHT = 30;

/** Icon-rail: product tiles with Settings at bottom. Tile click opens product. */
export function ProductIconRail({
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
    <IconRail
      tourId="product-switcher"
      home={
        <NavigationLink href="/" aria-label="LangWatch" display="flex" alignItems="center">
          <LogoIcon height={LOGO_HEIGHT} forceColorMode="light" />
        </NavigationLink>
      }
      footer={
        <IconRailTile
          icon={SettingsIcon}
          label="Settings"
          title="Settings"
          isActive={isSettingsActive}
          onOpen={() => host.navigate("/settings")}
        />
      }
    >
      {options.map((product) => (
        <IconRailTile
          key={product.id}
          icon={product.icon}
          label={product.label}
          title={`${product.label}: ${product.pitch}`}
          isActive={product.id === activeProductId && !isSettingsActive}
          onOpen={() => openProduct(product)}
        />
      ))}
    </IconRail>
  );
}
