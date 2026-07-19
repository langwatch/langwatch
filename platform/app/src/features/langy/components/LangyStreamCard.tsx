import { Box, HStack, Text } from "@chakra-ui/react";
import { FileText, Sparkles } from "lucide-react";
import type React from "react";

/**
 * STUB — the render surface for a mid-stream UI card
 * (LANGY_WORKER_REDESIGN_PLAN §0). The worker can emit a `card` frame between
 * tokens (e.g. "downloading a trace"); it rides the same authenticated, ordered
 * stream as the prose and lands in the token buffer as a `milestone` entry
 * (`kind` + `detail`). This component turns that into an inline card.
 *
 * It is deliberately a STUB: the registry has one placeholder renderer and a
 * generic fallback, and it is not yet wired into the live message renderer —
 * that is the S4 "progressive rendering" step. It exists now so the card
 * contract (kind → component) has a home and a type the relay/UI agree on.
 */
export interface LangyStreamCardProps {
  kind: string;
  detail?: string;
  data?: unknown;
}

/** A card renderer for a specific `kind`. Add real ones here as they land. */
type LangyStreamCardRenderer = React.FC<LangyStreamCardProps>;

const TraceDownloadCard: LangyStreamCardRenderer = ({ detail }) => (
  <LangyStreamCardShell icon={<FileText size={14} />} title="Opening a trace">
    {detail ? <Text fontSize="xs" color="gray.500">{detail}</Text> : null}
  </LangyStreamCardShell>
);

/**
 * kind → renderer. STUB: only `trace_download` is sketched, as the example from
 * the design. Everything else falls back to the generic card below.
 */
const CARD_RENDERERS: Record<string, LangyStreamCardRenderer> = {
  trace_download: TraceDownloadCard,
};

/** Shared card chrome so every card looks consistent. */
function LangyStreamCardShell({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="lg"
      px={3}
      py={2}
      bg="gray.50"
      my={1}
    >
      <HStack gap={2}>
        <Box color="orange.400">{icon}</Box>
        <Text fontSize="sm" fontWeight="medium">
          {title}
        </Text>
      </HStack>
      {children}
    </Box>
  );
}

/**
 * Render a mid-stream card. Unknown kinds fall back to a generic card that names
 * the kind — so a new worker card never renders as nothing while its bespoke
 * component is still being built.
 */
export function LangyStreamCard(props: LangyStreamCardProps) {
  const Renderer = CARD_RENDERERS[props.kind];
  if (Renderer) return <Renderer {...props} />;
  return (
    <LangyStreamCardShell
      icon={<Sparkles size={14} />}
      title={props.detail ?? props.kind}
    />
  );
}
