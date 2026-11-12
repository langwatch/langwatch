/**
 * The "Dashboards" section in the LLM Ops sidebar, lent through `StarredDashboardsToken`
 * (§10.1): the dashboards the member pinned to the project (their stars there), the first 7
 * then "All pinned (N)", and a "+" that makes a pinned dashboard and opens "Add a widget".
 * @see modules/navigation/specs/product-sidebars.feature
 */

import type { StarredDashboardsProps } from "@langwatch/analytics-client";
import { SidebarSectionLabel } from "@langwatch/design-system/app-shell";
import { Box, Link as ChakraLink, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { LayoutDashboard, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";
import { useBoardReader } from "../../behavior/use-board-access.ts";
import { useFavourites } from "../../behavior/use-favourites.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { dashboardsPath } from "../../model/boards.ts";
import { CURATED_BOARDS } from "../../model/curated-boards.ts";
import { type StarredLink, starredLinks } from "../../model/sidebar-boards.ts";
import { NewDashboardButton } from "../elements/new-dashboard-button.tsx";

/** Rows shown before the rest sit behind "All pinned (N)": the sidebar stays short. */
const PINNED_SHOWN_MAX = 7;

/** What the create path offers: the "+" and the empty-state item both run `onAdd`. */
type CreateControls = { isCreating: boolean; onAdd: () => void };

export function StarredDashboardsSection(_props: StarredDashboardsProps) {
  const host = useAnalyticsHost();
  const favourites = useFavourites();
  const { mayCreate } = useBoardReader();
  const projectSlug = host.project()?.slug;
  if (!projectSlug) return null;
  const isLoaded = !favourites.isLoading && !favourites.loadError;
  const links = isLoaded
    ? starredLinks({ stars: favourites.stars, curated: CURATED_BOARDS, projectSlug })
    : [];
  // A member who may not add one sees the section only for what it lists.
  if (!mayCreate && links.length === 0) return null;
  const frame = (create?: CreateControls) => (
    <SectionFrame links={links} isLoaded={isLoaded} projectSlug={projectSlug} create={create} />
  );
  // The create path reads the board list to name the new one; only members who may create mount it.
  return mayCreate ? <WithCreate>{frame}</WithCreate> : frame();
}

function WithCreate({ children }: { children: (create: CreateControls) => ReactNode }) {
  const saved = useSavedDashboards();
  return children({
    isCreating: saved.isCreating,
    // Pinned on creation; drop `pin` to stop pinning.
    onAdd: () => saved.createBoard({ pin: true, addWidget: true }),
  });
}

function SectionFrame({
  links,
  isLoaded,
  projectSlug,
  create,
}: {
  links: StarredLink[];
  isLoaded: boolean;
  projectSlug: string;
  create?: CreateControls;
}) {
  const shown = links.slice(0, PINNED_SHOWN_MAX);

  return (
    <VStack as="section" aria-label="Dashboards" align="stretch" gap={0.5} width="full">
      {/* The same frame and label as navigation's own groups, so it reads like "Build". */}
      <HStack minHeight="28px" paddingX={2} paddingTop={2.5} paddingBottom={0.5} gap={1}>
        <SidebarSectionLabel label="Dashboards" />
        {create && <NewDashboardButton isCreating={create.isCreating} onCreate={create.onAdd} />}
      </HStack>
      <VStack as="ul" align="stretch" gap={0.5} margin={0} padding={0}>
        {create && isLoaded && links.length === 0 && (
          <AddDashboardRow isCreating={create.isCreating} onAdd={create.onAdd} />
        )}
        {shown.map((link) => (
          <PinnedRow key={link.key} link={link} />
        ))}
        {links.length > PINNED_SHOWN_MAX && (
          <PinnedRow
            link={{
              key: "all-pinned",
              name: `All pinned (${links.length})`,
              href: dashboardsPath({ projectSlug }),
            }}
            isAll
          />
        )}
      </VStack>
    </VStack>
  );
}

/** The dotted-outline first item while nothing is pinned; it does what the "+" does. */
function AddDashboardRow({ isCreating, onAdd }: { isCreating: boolean; onAdd: () => void }) {
  return (
    <Box as="li" listStyleType="none" width="full">
      <Box
        as="button"
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        borderRadius="lg"
        borderWidth="1px"
        borderStyle="dashed"
        borderColor="border.emphasized"
        paddingX={2}
        paddingY="3px"
        textStyle="bodySm"
        color="fg.subtle"
        cursor="pointer"
        _hover={{ color: "fg", background: "border/50" }}
        aria-disabled={isCreating || void 0}
        onClick={() => {
          if (!isCreating) onAdd();
        }}
      >
        <Plus size={14} aria-hidden />
        Add dashboard
      </Box>
    </Box>
  );
}

function PinnedRow({ link, isAll = false }: { link: StarredLink; isAll?: boolean }) {
  const host = useAnalyticsHost();
  return (
    <Box as="li" listStyleType="none" width="full">
      <ChakraLink
        href={link.href}
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        borderRadius="lg"
        paddingX={2}
        paddingY="4px"
        textStyle="bodySm"
        color="fg.subtle"
        textDecoration="none"
        _hover={{ color: "fg", background: "border/50" }}
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          host.navigate(link.href);
        }}
      >
        {!isAll && (
          <Box as="span" display="flex" flexShrink={0}>
            <LayoutDashboard size={14} strokeWidth={1.9} aria-hidden />
          </Box>
        )}
        <Text as="span" truncate minWidth={0}>
          {link.name}
        </Text>
      </ChakraLink>
    </Box>
  );
}
