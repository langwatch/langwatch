import { Alert, Button, HStack, Spacer, Text } from "@chakra-ui/react";
import { Eye, LogOut } from "lucide-react";

import { Link } from "~/components/ui/link";

/**
 * Persistent "Viewing as admin" banner rendered server-side in
 * DashboardLayout when the current admin is looking at another user's
 * personal workspace OR a team they're not an explicit TeamUser of.
 *
 * Copy splits by workspaceKind:
 *   - personal: another user's private workspace. Mirrors GitHub Sudo /
 *     Stripe "Acting as merchant", "This is not your data" is correct,
 *     the admin is viewing content owned by a different principal.
 *   - team: an org-owned team the admin is not an explicit member of.
 *     The admin is still entitled to this data as org admin, so the
 *     impersonation framing is wrong. Copy softens to a neutral
 *     "Viewing as org admin" with the audit-log pointer, so a solo or
 *     small-org admin drilling into teams they de-facto own does not
 *     see scary boundary-violation language.
 *
 * Layout-component-driven (NOT a client-side flag) for reload-safety:
 * direct-pasting /[someUserPersonalProjectSlug]/traces as admin still
 * renders the banner on first paint.
 *
 * Audit/OCSF emission lives at the tRPC layer
 * (`governance.recordWorkspaceView`), independent of this banner.
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
  const message =
    workspaceKind === "personal"
      ? `Viewing ${workspaceLabel}'s personal workspace as org admin. This is not your data.`
      : `Viewing ${workspaceLabel} as org admin.`;
  return (
    <Alert.Root status="info" variant="surface">
      <Alert.Indicator>
        <Eye size={16} />
      </Alert.Indicator>
      <Alert.Content>
        <HStack gap={2} flexWrap="wrap" alignItems="center" width="full">
          <Text fontSize="sm" fontWeight="medium">
            {message}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Each access is logged at{" "}
            <Link href="/settings/audit-log" color="blue.600">
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
