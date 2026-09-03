import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { toRelativeSameOriginHref } from "@langwatch/langy-contract";
import {
  CapabilityRowSkeletons,
  LangyCapabilityCard as LangyCapabilityCardPresentation,
  type CapabilityIconName,
  type CapabilitySurface,
  type LangyCapabilityTone,
} from "../../../../../index";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { useSpaLinkClick } from "../../../behavior/logic/spa-link";
import { LangySpaAnchor } from "../langy-spa-anchor";
import { buildSurfaceHref, SURFACE_LABEL } from "../../../model/capabilities/capability-registry";

export { CapabilityRowSkeletons };

type CapabilityCardProps = {
  tone: LangyCapabilityTone;
  surface: CapabilitySurface;
  overline: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  deepLink?: boolean;
  projectSlug?: string | null;
  resourceId?: string | null;
  platformUrl?: string | null;
  icon?: CapabilityIconName;
};

/** App adapter: reusable card presentation plus this app's SPA navigation. */
export function LangyCapabilityCard({
  actions,
  deepLink = true,
  platformUrl,
  projectSlug,
  resourceId,
  surface,
  ...presentation
}: CapabilityCardProps) {
  const footer =
    deepLink || actions ? (
      <HStack gap={2} justify="space-between" align="center" flexWrap="wrap">
        <Box>{actions}</Box>
        {deepLink ? (
          <CapabilityDeepLinkChip
            surface={surface}
            projectSlug={projectSlug}
            resourceId={resourceId}
            platformUrl={platformUrl}
          />
        ) : null}
      </HStack>
    ) : null;

  return <LangyCapabilityCardPresentation {...presentation} surface={surface} footer={footer} />;
}

function CapabilityDeepLinkChip({
  surface,
  projectSlug,
  resourceId,
  platformUrl,
}: {
  surface: CapabilitySurface;
  projectSlug?: string | null;
  resourceId?: string | null;
  platformUrl?: string | null;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const preciseHref = platformUrl ? toRelativeSameOriginHref({ url: platformUrl, origin }) : null;
  const href = preciseHref ?? buildSurfaceHref({ surface, projectSlug, resourceId });
  const onClick = useSpaLinkClick(href ?? "");
  if (!href) return null;

  return (
    <LangySpaAnchor
      href={href}
      display="inline-flex"
      alignItems="center"
      gap={1}
      textStyle="xs"
      fontWeight="560"
      color="orange.solid"
      marginLeft="auto"
      _hover={{ textDecoration: "underline" }}
      onClick={onClick}
    >
      {`Open in ${SURFACE_LABEL[surface]}`}
      <ArrowUpRight size={12} />
    </LangySpaAnchor>
  );
}

export function CapabilityRow({
  href,
  primary,
  secondary,
}: {
  href?: string | null;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  const body = (
    <VStack align="stretch" gap={0} flex={1} minWidth={0}>
      <Text textStyle="xs" color="fg" truncate>
        {primary}
      </Text>
      {secondary !== undefined && secondary !== null ? (
        <Text textStyle="2xs" color="fg.muted" truncate>
          {secondary}
        </Text>
      ) : null}
    </VStack>
  );

  if (!href) {
    return (
      <HStack gap={2} paddingX={2} paddingY={1.5}>
        {body}
      </HStack>
    );
  }

  return (
    <LangySpaAnchor
      href={href}
      display="flex"
      alignItems="center"
      gap={2}
      paddingX={2}
      paddingY={1.5}
      borderRadius="md"
      _hover={{ background: "bg.muted" }}
    >
      {body}
      <ArrowUpRight size={12} color="var(--chakra-colors-fg-subtle)" />
    </LangySpaAnchor>
  );
}
