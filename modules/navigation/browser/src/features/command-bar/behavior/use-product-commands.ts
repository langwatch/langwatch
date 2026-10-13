import { useCodingAgentLinks } from "../../../behavior/use-coding-agent-links.ts";
import { useLlmOpsProjectSlug } from "../../../behavior/use-llm-ops-project-slug.ts";
import { usePersonalWorkspace } from "../../../behavior/use-personal-workspace.ts";
import { useReachableProducts } from "../../../behavior/use-reachable-products.ts";
import { useVisibleSectionNavItems } from "../../../behavior/use-visible-section-nav-items.ts";
import { gatewayNavItems, governanceNavItems } from "../../../model/section-nav-items.ts";
import type { Command } from "../model/command-bar-types.ts";
import { productPageCommands, switchProductCommands } from "../model/product-commands.ts";

/**
 * "Switch to <product>" and every page of the products the person can open,
 * gated by the same reachability, flags and lists the sidebars use.
 */
export function useProductCommands(): Command[] {
  const { reachableProducts } = useReachableProducts();
  const llmOpsProjectSlug = useLlmOpsProjectSlug();
  const { personalProjectSlug, features: personalFeatures } = usePersonalWorkspace();
  const codingAgentLinks = useCodingAgentLinks();
  const gatewayItems = useVisibleSectionNavItems(gatewayNavItems);
  const governanceItems = useVisibleSectionNavItems(governanceNavItems);

  return [
    ...switchProductCommands({ reachableProducts, projectSlug: llmOpsProjectSlug }),
    ...productPageCommands({
      reachableProducts,
      personalProjectSlug,
      personalFeatures,
      codingAgentLinks,
      gatewayItems,
      governanceItems,
    }),
  ];
}
