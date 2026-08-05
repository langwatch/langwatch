import {
  Alert,
  Box,
  Button,
  HStack,
  IconButton,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { Eye, LogOut, X } from "lucide-react";
import { useEffect, useState } from "react";

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
/** Per-workspace dismissal flag — re-emerges when the admin switches
 *  workspaces or the dismissal expires (24h). The banner is a governance
 *  signal, not a soft notification: the audit trail still runs whether
 *  it's collapsed or expanded; we just give the admin a way to drop it
 *  out of the way during a long debugging session. */
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY_PREFIX = "langwatch:admin-banner-dismissed:v1:";

function loadDismissed(workspaceLabel: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + workspaceLabel);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function persistDismissed(workspaceLabel: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + workspaceLabel,
      String(Date.now()),
    );
  } catch {
    // storage may be full / disabled
  }
}

export function AdminViewingAsBanner({
  workspaceLabel,
}: {
  workspaceLabel: string;
}) {
  // Two visual states:
  //   - full   — first paint on a fresh workspace view, the loud
  //              "this is not your data" alert.
  //   - mini   — after dismiss within the 24h window: a small "👁
  //              someone-else · Exit" chip that stays out of the way
  //              but keeps the persistent reminder. Cannot be hidden
  //              entirely; the governance team's bar is "always
  //              visible signal, even if compressed".
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(loadDismissed(workspaceLabel));
  }, [workspaceLabel]);

  const handleDismiss = () => {
    persistDismissed(workspaceLabel);
    setCollapsed(true);
  };

  if (collapsed) {
    return (
      <Box
        paddingX={3}
        paddingY={1}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.subtle"
        // Only the top-left corner curves — the banner sits at the
        // very top of the inner page chrome and inherits that chrome's
        // rounded top-left so the curve is continuous. All other
        // corners are flush against the page edges.
        borderRadius={0}
        borderTopLeftRadius="xl"
      >
        <HStack gap={2} fontSize="xs" color="fg.muted">
          <Eye size={12} />
          <Text>
            Viewing{" "}
            <Text as="span" fontWeight="semibold" color="fg">
              {workspaceLabel}
            </Text>{" "}
            as admin · audit-logged.
          </Text>
          <Spacer />
          <Link
            href="/settings/audit-log"
            color="fg.subtle"
            _hover={{ color: "fg" }}
          >
            audit log
          </Link>
          <Button
            asChild
            size="2xs"
            variant="ghost"
            aria-label="Exit and return to governance bird's-eye"
          >
            <Link href="/governance">
              <LogOut size={11} />
              Exit
            </Link>
          </Button>
        </HStack>
      </Box>
    );
  }

  const message = `Viewing ${workspaceLabel}'s personal workspace as org admin. This is not your data.`;
  return (
    <Alert.Root
      status="info"
      variant="surface"
      // Top-left only — matches the inner page chrome's rounded
      // top-left corner so the banner continues that curve.
      borderRadius={0}
      borderTopLeftRadius="xl"
    >
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
          {/* Collapse to a compact one-line chip for 24h. The audit
              trail still fires regardless; this is purely about not
              eating 36px of chrome on every traces page once the
              admin has read the warning the first time. */}
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Collapse banner (24h)"
            onClick={handleDismiss}
          >
            <X size={12} />
          </IconButton>
        </HStack>
      </Alert.Content>
    </Alert.Root>
  );
}
