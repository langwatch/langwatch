import { Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuArrowRight, LuTriangleAlert } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

interface LegacyTracesDeprecationBannerProps {
  /** When set, the CTA deep-links to this trace inside the Trace Explorer drawer. */
  traceId?: string;
}

/**
 * Deprecation notice shown inside the legacy trace drawer. The legacy Traces
 * page is gone and Trace Explorer is the trace experience; the drawer stays
 * registered only because links shared before the change name it explicitly,
 * and it will be removed too. Deliberately not dismissible — it is a removal
 * warning, not an announcement.
 */
export function LegacyTracesDeprecationBanner({
  traceId,
}: LegacyTracesDeprecationBannerProps) {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const projectSlug = project?.slug;

  if (!projectSlug) return null;

  // Hard-nav rather than openDrawer: swapping the v1 drawer for the v2 one
  // in place kept losing races against Chakra's unmount-fired onOpenChange
  // (see the git history of NewTracesPromo). A full navigation drops every
  // in-flight drawer state deterministically.
  const handleOpenExplorer = (e: React.MouseEvent) => {
    e.preventDefault();
    const suffix = traceId
      ? `?drawer.open=traceV2Details&drawer.traceId=${encodeURIComponent(traceId)}`
      : "";
    window.location.href = `/${projectSlug}/traces${suffix}`;
  };

  return (
    <HStack
      width="full"
      gap={{ base: 2.5, md: 3.5 }}
      paddingX={{ base: 4, md: 5 }}
      paddingY={2}
      align="center"
      bg="orange.subtle"
      color="orange.fg"
      borderBottomWidth="1px"
      borderBottomColor="orange.muted"
      flexShrink={0}
    >
      <Icon as={LuTriangleAlert} boxSize={3.5} flexShrink={0} />
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <Text textStyle="xs" fontWeight="600" truncate width="full">
          This view is going away soon
        </Text>
      </VStack>
      <Button
        size="xs"
        colorPalette="orange"
        variant="surface"
        flexShrink={0}
        onClick={handleOpenExplorer}
      >
        Open Trace Explorer
        <Icon as={LuArrowRight} boxSize={3.5} />
      </Button>
    </HStack>
  );
}
