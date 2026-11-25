/** Icon-rail product column (moved from platform/app; uses NavigationLink). */

import { IconRail, IconRailTile } from "@langwatch/design-system/app-shell";
import { LogoIcon } from "@langwatch/design-system/logo-icon";
import { Settings as SettingsIcon } from "lucide-react";

import { useProductHome } from "../../behavior/use-product-home.ts";
import { useReachableProducts } from "../../behavior/use-reachable-products.ts";
import { useSettingsEntryHref } from "../../behavior/use-settings-entry-href.ts";
import { writeDashboardsSidebarHint } from "../../model/dashboards-sidebar-hint.ts";
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
  const settingsHref = useSettingsEntryHref();
  const { reachableProducts } = useReachableProducts();
  const homeOf = useProductHome();

  const options = PRODUCTS.filter(
    (product) => product.id === activeProductId || reachableProducts.includes(product.id),
  );

  const openProduct = (product: ProductDefinition) => {
    if (product.id === activeProductId && !isSettingsActive) return;
    const home = homeOf(product);
    if (!home) return;
    // Choosing Dashboards means its own sidebar, whatever page the reader left.
    if (product.id === "dashboards")
      writeDashboardsSidebarHint({ hint: "dashboards", projectId: host.project()?.id });
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
          onOpen={() => host.navigate(settingsHref)}
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
