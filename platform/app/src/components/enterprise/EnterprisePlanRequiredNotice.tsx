import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";

import { Link } from "~/components/ui/link";
import { explainHandledError } from "~/features/errors";

/**
 * One region of a page the organization's plan does not include.
 *
 * The plan counterpart to {@link PermissionRequiredNotice}: a dashboard built
 * from panels behind different plan gates keeps rendering the panels the plan
 * covers, and the one it does not says so instead of failing to load. The
 * inline sibling of {@link EnterpriseLockedSurface}, which takes a whole page
 * down.
 *
 * The words come from the `enterprise_plan_required` entry in the client
 * presentation registry, so the panel reads the same whether the client
 * predicted the refusal or the server sent one.
 *
 * Not an error state: nothing failed, so the tone is muted and there is no
 * error id to quote.
 */
export function EnterprisePlanRequiredNotice({
  detail,
}: {
  /** One extra line about what stays hidden on the current plan. Optional. */
  detail?: string;
}) {
  const copy = explainHandledError({
    code: "enterprise_plan_required",
    meta: {},
    httpStatus: 402,
    fault: "customer",
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });

  return (
    <Box
      role="note"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      backgroundColor="bg.subtle"
      paddingX={4}
      paddingY={3}
    >
      <HStack gap={3} alignItems="flex-start">
        <Box color="fg.muted" display="flex" flexShrink={0} marginTop="2px">
          <Lock size={14} aria-hidden="true" />
        </Box>
        <Stack gap={0.5} flex="1" minWidth={0}>
          <Text fontSize="sm" fontWeight="medium">
            {copy.title}
          </Text>
          {copy.description && (
            <Text fontSize="xs" color="fg.muted">
              {copy.description}
            </Text>
          )}
          {detail && (
            <Text fontSize="xs" color="fg.muted">
              {detail}
            </Text>
          )}
          <Link href="/settings/subscription" fontSize="xs" color="blue.600">
            See plans
          </Link>
        </Stack>
      </HStack>
    </Box>
  );
}
