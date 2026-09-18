import { Alert, Box, Button, HStack, IconButton, Spacer, Text } from "@chakra-ui/react";
import { nowInstant } from "@langwatch/time";
import { Eye, LogOut, X } from "lucide-react";
import { useEffect, useState } from "react";

import { NavigationLink } from "../elements/navigation-link.tsx";

/** Admin viewing-as banner for personal workspaces (only where impersonation is real) */
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY_PREFIX = "langwatch:admin-banner-dismissed:v1:";

function loadDismissed(workspaceLabel: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + workspaceLabel);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return nowInstant().epochMilliseconds - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function persistDismissed(workspaceLabel: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + workspaceLabel,
      String(nowInstant().epochMilliseconds),
    );
  } catch {
    // storage may be full / disabled
  }
}

export function AdminViewingAsBanner({ workspaceLabel }: { workspaceLabel: string }) {
  // Two visual states: full on first paint (the loud "this is not your
  // data" alert), mini after 24h-dismiss (a small persistent chip). Never
  // fully hidden — the governance team's bar is "always visible signal,
  // even if compressed".
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
          <NavigationLink href="/settings/audit-log" color="fg.subtle" _hover={{ color: "fg" }}>
            audit log
          </NavigationLink>
          <Button
            asChild
            size="2xs"
            variant="ghost"
            aria-label="Exit and return to governance bird's-eye"
          >
            <NavigationLink href="/governance">
              <LogOut size={11} />
              Exit
            </NavigationLink>
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
            <NavigationLink href="/settings/audit-log" color="blue.600">
              /settings/audit-log
            </NavigationLink>
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
            <NavigationLink href="/governance">
              <LogOut size={12} />
              Exit
            </NavigationLink>
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
