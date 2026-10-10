import { ActivityTimeline } from "@langwatch/design-system/activity-timeline";
import { Badge, Box, Skeleton, Text } from "@langwatch/design-system/primitives";
import {
  Circle,
  CircleCheck,
  CircleMinus,
  Clock3,
  FileCheck2,
  Globe,
  KeyRound,
  Pause,
  Pencil,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { api } from "../../../../behavior/ops-api.ts";

const EVENT_ICONS: Record<string, LucideIcon> = {
  "lw.identity.connection_registered": Plus,
  "lw.identity.domain_claimed": Globe,
  "lw.identity.domain_claim_approved": CircleCheck,
  "lw.identity.domain_claim_rejected": CircleMinus,
  "lw.identity.verification_requested": FileCheck2,
  "lw.identity.domain_verified": ShieldCheck,
  "lw.identity.domain_attested": ShieldCheck,
  "lw.identity.domain_withdrawn": CircleMinus,
  "lw.identity.domain_proof_wavered": Clock3,
  "lw.identity.domain_proof_lapsed": Clock3,
  "lw.identity.domain_proof_recovered": ShieldCheck,
  "lw.identity.connection_renamed": Pencil,
  "lw.identity.connection_activated": Play,
  "lw.identity.connection_resumed": Play,
  "lw.identity.connection_suspended": Pause,
  "lw.identity.connection_arrival_policy_set": Users,
  "lw.identity.connection_idp_updated": KeyRound,
  "lw.identity.connection_discarded": CircleMinus,
  "lw.identity.connection_torn_down": CircleMinus,
  "lw.identity.teardown_requested": CircleMinus,
  "lw.identity.replacement_connection_registered": Plus,
  "lw.identity.migration_route_selected": Settings2,
  "lw.identity.migration_finalization_started": Settings2,
  "lw.identity.migration_finalized": CircleCheck,
};

export function ConnectionHistory({ connectionId }: { connectionId: string }) {
  const history = api.ssoConnections.getHistory.useQuery({ connectionId });
  const rows = history.data ?? [];
  const entries = rows.map((entry) => {
    const EventIcon = EVENT_ICONS[entry.eventType ?? ""] ?? Circle;
    return {
      id: entry.eventId,
      occurredAtMs: entry.occurredAtMs,
      content: entry.summary,
      icon: <EventIcon size={14} />,
      meta: entry.carriedOver ? (
        <Badge colorPalette="gray" size="xs">
          Carried over
        </Badge>
      ) : null,
    };
  });
  let emptyState = <Text>Nothing has happened to this connection yet.</Text>;
  if (history.isLoading) emptyState = <Skeleton height="16" />;
  if (history.error)
    emptyState = <Text color="fg.error">This connection’s history could not be loaded.</Text>;

  return (
    <Box
      as="section"
      aria-label="History"
      borderTopWidth="1px"
      borderColor="border.muted"
      paddingTop={5}
    >
      <ActivityTimeline
        title="History"
        entries={history.isLoading || history.error ? [] : entries}
        emptyState={emptyState}
      />
    </Box>
  );
}
