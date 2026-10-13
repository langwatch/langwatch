import type { CodingAgentLinks } from "../../../behavior/use-coding-agent-links.ts";
import type { PersonalWorkspaceFeatures } from "../../../behavior/use-personal-workspace.ts";
import {
  personalConfigureNavItem,
  personalLibraryNavItems,
  personalPullRequestsNavItem,
  personalSessionsNavItem,
  personalTracesNavItem,
  personalUsageNavItem,
} from "../../../model/personal-nav-items.ts";
import { type ProductId, productById } from "../../../model/products.ts";
import { projectNavItems } from "../../../model/project-nav-items.ts";
import type { SectionNavItemData } from "../../../model/section-nav-items.ts";
import type { Command } from "./command-bar-types.ts";

const SWITCH_KEYWORDS = ["switch product", "change product", "product", "open"];

function pageCommand({
  productId,
  label,
  href,
  icon,
  keywords,
}: {
  productId: ProductId;
  label: string;
  href: string;
  icon: Command["icon"];
  keywords: readonly string[];
}): Command {
  const product = productById(productId);
  return {
    id: `product-${productId}-${href}`,
    label,
    productLabel: product.label,
    icon,
    category: "navigation",
    keywords: [...keywords, product.label.toLowerCase()],
    path: href,
  };
}

/** One "Switch to <product>" command for each product the person can reach and that has a home. */
export function switchProductCommands({
  reachableProducts,
  projectSlug,
}: {
  reachableProducts: readonly ProductId[];
  projectSlug: string | null;
}): Command[] {
  return reachableProducts.flatMap((productId) => {
    const product = productById(productId);
    const home = product.homeHref({ projectSlug });
    if (!home) return [];
    return [
      {
        id: `product-${productId}-switch`,
        label: `Switch to ${product.label}`,
        description: product.pitch,
        icon: product.icon,
        category: "navigation",
        keywords: [...SWITCH_KEYWORDS, product.label.toLowerCase()],
        path: home,
      } satisfies Command,
    ];
  });
}

/**
 * Every Me, Gateway and Governance page the person can reach, read from the
 * same lists the sidebars render. LLM Ops pages are the project navigation
 * commands the bar already offers.
 */
export function productPageCommands({
  reachableProducts,
  personalProjectSlug,
  personalFeatures,
  codingAgentLinks,
  gatewayItems,
  governanceItems,
}: {
  reachableProducts: readonly ProductId[];
  personalProjectSlug: string | null;
  personalFeatures: PersonalWorkspaceFeatures | undefined;
  codingAgentLinks: CodingAgentLinks;
  gatewayItems: readonly SectionNavItemData[];
  governanceItems: readonly SectionNavItemData[];
}): Command[] {
  const fromSection = (productId: ProductId, items: readonly SectionNavItemData[]) =>
    items.map((item) =>
      pageCommand({
        productId,
        label: item.label,
        href: item.href,
        icon: item.icon,
        keywords: item.keywords ?? [],
      }),
    );

  const mePages = [
    personalUsageNavItem,
    ...(personalProjectSlug
      ? [{ ...personalTracesNavItem, href: personalTracesNavItem.hrefFor(personalProjectSlug) }]
      : []),
    personalSessionsNavItem,
    personalPullRequestsNavItem,
    ...(personalProjectSlug
      ? personalLibraryNavItems
          .filter((item) => personalFeatures?.[item.feature])
          .map((item) => ({ ...item, href: `/${personalProjectSlug}/${item.segment}` }))
      : []),
    personalConfigureNavItem,
  ].map((item) => pageCommand({ productId: "me", ...item }));

  const llmOpsCodingAgentPages = [
    ...(codingAgentLinks.shouldShowSessions
      ? [{ item: projectNavItems.coding_agent_sessions, icon: personalSessionsNavItem.icon }]
      : []),
    ...(codingAgentLinks.shouldShowPullRequests
      ? [
          {
            item: projectNavItems.coding_agent_pull_requests,
            icon: personalPullRequestsNavItem.icon,
          },
        ]
      : []),
  ].map(({ item, icon }) =>
    pageCommand({
      productId: "llm-ops",
      label: item.title,
      href: item.path,
      icon,
      keywords: item.title.toLowerCase().includes("pull")
        ? personalPullRequestsNavItem.keywords
        : personalSessionsNavItem.keywords,
    }),
  );

  return [
    ...(reachableProducts.includes("llm-ops") ? llmOpsCodingAgentPages : []),
    ...(reachableProducts.includes("me") ? mePages : []),
    ...(reachableProducts.includes("gateway") ? fromSection("gateway", gatewayItems) : []),
    ...(reachableProducts.includes("governance") ? fromSection("governance", governanceItems) : []),
  ];
}

/** Tags the project navigation commands the bar already offers with the LLM Ops product name. */
export function withLlmOpsProductLabel(commands: readonly Command[]): Command[] {
  const label = productById("llm-ops").label;
  return commands.map((command) =>
    command.id.startsWith("nav-ops") || command.id.startsWith("nav-settings")
      ? command
      : { ...command, productLabel: label },
  );
}
