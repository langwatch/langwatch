/**
 * The rail and the header every analytics page sits in.
 *
 * `platform/app`'s `GraphsLayout`, minus its outermost wrapper.
 * `DashboardLayout` was the application's chrome — the sidebar, the top bar and
 * the drawer mount — and chrome belongs to the route tree, not to a screen:
 * these pages are children of a layout route the composing application still
 * serves. Every family since governance has dropped the same wrapper.
 *
 * WHICH ENTRY IS SELECTED ARRIVES AS A PROP. The platform rail matched the
 * pathname inside each `MenuLink`; a governed screen may not read the address
 * for what the router already knows, so the screen names its own page and the
 * rail marks it. That is the same reason the screens take their page as a prop
 * rather than reading it back.
 */

import { Container, HStack, VStack } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";
import { SmallLabel } from "@langwatch/design-system/small-label";

import { useAnalyticsHost } from "../../model/analytics-host";
import { useFilterToggle } from "../../behavior/use-filter-toggle";
import { MenuLink } from "../elements/analytics-menu-link";
import { AnalyticsHeader, type AnalyticsHeaderProps } from "./analytics-header";
import { CustomDashboardsSection } from "./custom-dashboards-section";
import { CustomQueryMenuLink } from "./custom-query-menu-link";

/** Which rail entry the page being rendered is. */
export type AnalyticsRailEntry =
  | "overview"
  | "users"
  | "topics"
  | "metrics"
  | "evaluations"
  | "query"
  | "reports"
  | "custom";

export default function AnalyticsLayout({
  children,
  title,
  railEntry,
  analyticsHeaderProps,
  extraHeaderButtons,
}: PropsWithChildren<{
  title: string;
  railEntry?: AnalyticsRailEntry;
  analyticsHeaderProps?: Omit<AnalyticsHeaderProps, "title">;
  extraHeaderButtons?: React.ReactNode;
}>) {
  const host = useAnalyticsHost();
  const project = host.project();
  const { showFilters } = useFilterToggle();

  return (
    <>
      <AnalyticsHeader
        title={title}
        {...analyticsHeaderProps}
        extraHeaderButtons={extraHeaderButtons}
      />
      <HStack align="start" width="full" minHeight="full">
        <VStack
          align="start"
          paddingX={2}
          paddingY={4}
          textStyle="sm"
          minWidth="180px"
          position="sticky"
          top={0}
          alignSelf="start"
          gap={1}
        >
          <MenuLink href={`/${project?.slug}/analytics`} isSelected={railEntry === "overview"}>
            Overview
          </MenuLink>
          <VStack align="start" width="full" gap={1}>
            <SmallLabel paddingX={4} paddingTop={4} paddingBottom={2} color="fg" textStyle="xs">
              Engagement
            </SmallLabel>
            <MenuLink href={`/${project?.slug}/analytics/users`} isSelected={railEntry === "users"}>
              Users
            </MenuLink>
            <MenuLink
              href={`/${project?.slug}/analytics/topics`}
              isSelected={railEntry === "topics"}
            >
              Topics
            </MenuLink>
          </VStack>
          <VStack align="start" width="full" gap={1}>
            <SmallLabel paddingX={4} paddingTop={4} paddingBottom={2} color="fg" textStyle="xs">
              Observability
            </SmallLabel>
            <MenuLink
              href={`/${project?.slug}/analytics/metrics`}
              isSelected={railEntry === "metrics"}
            >
              LLM Metrics
            </MenuLink>
            <MenuLink
              href={`/${project?.slug}/analytics/evaluations`}
              isSelected={railEntry === "evaluations"}
            >
              Online Evaluations
            </MenuLink>
          </VStack>
          <VStack align="start" width="full" gap={1}>
            <SmallLabel paddingX={4} paddingTop={4} paddingBottom={2} color="fg" textStyle="xs">
              Custom
            </SmallLabel>
            {project?.id && project.slug && (
              <CustomQueryMenuLink
                projectId={project.id}
                projectSlug={project.slug}
                isSelected={railEntry === "query"}
              />
            )}
            {project?.slug && <CustomDashboardsSection projectSlug={project.slug} />}
          </VStack>
        </VStack>
        <Container maxWidth={showFilters ? "1612" : "1200"} padding={4} paddingBottom={16}>
          {children}
        </Container>
      </HStack>
    </>
  );
}
