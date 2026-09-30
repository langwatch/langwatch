import { Box, HStack, Text } from "@chakra-ui/react";
import { Eye } from "lucide-react";

import { useLiteMemberGuard } from "~/hooks/useLiteMemberGuard";

/** A Lite Member's seat ceiling also applies to their personal workspace. */
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
          Your organization gives you view-only access, so you can read your
          workspace but not add to it. Ask an organization admin if you need to
          change something here.
        </Text>
      </HStack>
    </Box>
  );
}
