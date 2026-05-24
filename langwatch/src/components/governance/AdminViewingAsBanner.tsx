import { Alert, Button, HStack, Spacer, Text } from "@chakra-ui/react";
import { Eye, LogOut } from "lucide-react";

import { Link } from "~/components/ui/link";

/**
 * Persistent "Viewing as admin" banner rendered in DashboardLayout when
 * the current admin is looking at another user's personal workspace.
 *
 * Personal workspaces are the only surface where the impersonation
 * framing is real: a different principal owns the data, the admin is
 * stepping into someone else's account. Team workspaces do NOT trigger
 * this banner — ORG:ADMIN cascades to every team in the org as
 * implicit membership, so flagging team drill-throughs as
 * "impersonation" is noise (rchaves bug 19: solo and small-org admins
 * who de-facto own every team kept seeing the banner on their own
 * dashboard).
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
}: {
  workspaceLabel: string;
}) {
  const message = `Viewing ${workspaceLabel}'s personal workspace as org admin. This is not your data.`;
  return (
    <Alert.Root status="info" variant="surface">
      <Alert.Indicator>
        <Eye size={16} />
      </Alert.Indicator>
      <Alert.Content>
        <HStack gap={2} flexWrap="wrap" alignItems="center" width="full">
          <Text fontSize="sm" fontWeight="medium">
            {message}
          </Text>{" "}
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
