// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One framed section of the authentication page: a name, the sentence saying
 * what it holds, and the thing itself. Framed like its neighbours — an
 * unframed list on a page of cards reads as something that fell out of one.
 */
import { Card, Heading, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

export function SettingsCard({
  title,
  hint,
  testId,
  children,
}: {
  title: string;
  hint?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Card.Root width="full" data-testid={testId}>
      <Card.Body>
        <VStack align="stretch" gap={3}>
          <VStack align="start" gap={0.5}>
            <Heading size="sm">{title}</Heading>
            {hint && (
              <Text fontSize="xs" color="fg.muted">
                {hint}
              </Text>
            )}
          </VStack>
          {children}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
