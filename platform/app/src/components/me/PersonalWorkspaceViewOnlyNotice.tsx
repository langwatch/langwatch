import { Box, HStack, Text } from "@chakra-ui/react";
import { Eye } from "lucide-react";

import { useLiteMemberGuard } from "~/hooks/useLiteMemberGuard";

/**
 * Why a Lite Member's own workspace does not keep anything they add to it.
 *
 * A member's organization role caps what any of their role bindings can do
 * (`resolveBindingPermission` in `server/api/rbac.ts`), and that includes the
 * admin binding on the workspace provisioned for them. So reads work, writes do
 * not, and the workspace itself is left alone: it is still theirs, and it starts
 * taking writes again the moment they have full access.
 *
 * Saying so is the whole point of this. Without it the page looks broken rather
 * than restricted, because everything renders and only the save fails.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-integrity.feature
 */
export function PersonalWorkspaceViewOnlyNotice() {
  const { isLiteMember } = useLiteMemberGuard();

  if (!isLiteMember) return null;

  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      bg="bg.subtle"
      paddingY={3}
      paddingX={4}
      data-testid="personal-workspace-view-only-notice"
    >
      <HStack gap={3} align="start">
        <Box color="fg.muted" paddingTop={0.5}>
          <Eye size={16} />
        </Box>
        <Text fontSize="sm" color="fg.muted">
          Your organization gives you view-only access, so you can read your workspace but
          not add to it. Ask an organization admin if you need to change something here.
        </Text>
      </HStack>
    </Box>
  );
}
