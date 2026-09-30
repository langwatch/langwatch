import { Box, Button, Text } from "@chakra-ui/react";
import { Clock3 } from "lucide-react";
import { AuthCard } from "~/components/auth/AuthCard";
import { Dialog } from "~/components/ui/dialog";
import { Link } from "~/components/ui/link";
import { signOut } from "~/utils/auth-client";
import { AuthPrimaryButton } from "./AuthPrimaryButton";
import { AUTH_SECONDARY_STYLE } from "./AuthSecondaryButton";
import { AuthShell } from "./AuthShell";

export function TeamAccessWaiting({
  organizationName,
  onCheckAccess,
}: {
  organizationName: string;
  onCheckAccess: () => void;
}) {
  return (
    <Dialog.Root
      open
      size="full"
      closeOnEscape={false}
      closeOnInteractOutside={false}
    >
      <Dialog.Content
        aria-label="Waiting for team access"
        padding={0}
        borderRadius={0}
        borderWidth={0}
        minHeight="100dvh"
        positionerProps={{ padding: 0 }}
      >
        <AuthShell fillContainer>
          <AuthCard title="Waiting for team access" solid>
            <Box display="flex" justifyContent="center" color="auth.detail">
              <Clock3 size={28} aria-hidden="true" />
            </Box>
            <Text textAlign="center">
              You’re signed in to {organizationName}.
            </Text>
            <Text textAlign="center" color="fg.muted">
              Ask your organization’s administrator to add you to a team. Once
              they do, you’ll be able to open its projects.
            </Text>
            <AuthPrimaryButton onClick={onCheckAccess}>
              Check access
            </AuthPrimaryButton>
            <Button {...AUTH_SECONDARY_STYLE} asChild>
              <Link href="/">Back to home</Link>
            </Button>
            <Button {...AUTH_SECONDARY_STYLE} onClick={() => void signOut()}>
              Sign out
            </Button>
          </AuthCard>
        </AuthShell>
      </Dialog.Content>
    </Dialog.Root>
  );
}
