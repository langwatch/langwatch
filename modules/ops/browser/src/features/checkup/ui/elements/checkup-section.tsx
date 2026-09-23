import { Box, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** One titled band of the checkup page: a hairline above, one line of description, an action. */
export function CheckupSection({
  icon,
  title,
  description,
  action,
  testId,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Box
      as="section"
      width="full"
      borderTopWidth="1px"
      borderColor="border.muted"
      paddingY={{ base: 5, md: 6 }}
      data-testid={testId}
    >
      <VStack width="full" align="stretch" gap={5}>
        <VStack width="full" align="stretch" gap={1}>
          <HStack width="full" gap={2} align="center">
            {icon ? (
              <Box color="fg.muted" display="flex" flexShrink={0}>
                {icon}
              </Box>
            ) : null}
            <Text fontSize="md" fontWeight={600} letterSpacing="-0.01em">
              {title}
            </Text>
            {action ? (
              <>
                <Spacer />
                {action}
              </>
            ) : null}
          </HStack>
          {description ? (
            <Text fontSize="sm" lineHeight="1.55" color="fg.muted">
              {description}
            </Text>
          ) : null}
        </VStack>
        {children}
      </VStack>
    </Box>
  );
}

/** One item in a band's list, outlined so the eye sees where one row ends. */
export function CheckupSectionRow({ testId, children }: { testId?: string; children: ReactNode }) {
  return (
    <HStack
      width="full"
      gap={3}
      paddingX={4}
      paddingY={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="10px"
      data-testid={testId}
    >
      {children}
    </HStack>
  );
}
