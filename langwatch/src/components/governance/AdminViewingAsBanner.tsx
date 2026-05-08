import { Alert, Button, HStack, Spacer, Text } from "@chakra-ui/react";
import { Eye, LogOut } from "lucide-react";

import { Link } from "~/components/ui/link";

/**
 * Persistent "Viewing as admin" banner rendered server-side in
 * DashboardLayout when the current admin is looking at another user's
 * personal workspace OR a team they're not a member of. Mirrors the
 * GitHub Sudo / Stripe "Acting as merchant" pattern — context-clarity
 * affordance preventing the admin from confusing whose dashboard they
 * see at a serial drill-through pace.
 *
 * Layout-component-driven (NOT a client-side flag) for reload-safety:
 * direct-pasting /[someUserPersonalProjectSlug]/traces as admin still
 * renders the banner on first paint.
 *
 * Audit/OCSF emission lives at the tRPC layer (Sergey's
 * `governance.viewWorkspaceAs`), independent of this banner. Banner
 * is the user-facing chrome; audit-log is the governance trail.
 *
 * Spec: specs/ai-gateway/governance/admin-trace-access.feature
 */
export function AdminViewingAsBanner({
  workspaceLabel,
  workspaceKind,
}: {
  workspaceLabel: string;
  workspaceKind: "personal" | "team";
}) {
  return (
    <Alert.Root status="info" variant="surface">
      <Alert.Indicator>
        <Eye size={16} />
      </Alert.Indicator>
      <Alert.Content>
        <HStack gap={2} flexWrap="wrap" alignItems="center" width="full">
          <Text fontSize="sm" fontWeight="medium">
            Viewing {workspaceLabel}'s {workspaceKind} workspace as org
            admin. This is not your data.
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Each access is logged at{" "}
            <Link href="/settings/audit-log" color="orange.600">
              /settings/audit-log
            </Link>
            .
          </Text>
          <Spacer />
          <Button
            asChild
            size="xs"
            variant="outline"
            colorPalette="blue"
            aria-label="Exit and return to governance bird's-eye"
          >
            <Link href="/governance">
              <LogOut size={12} />
              Exit
            </Link>
          </Button>
        </HStack>
      </Alert.Content>
    </Alert.Root>
  );
}
