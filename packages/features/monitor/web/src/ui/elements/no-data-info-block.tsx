/**
 * The empty state a list shows before anything has been configured.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/components/NoDataInfoBlock.tsx`,
 * which the workflows page, the annotation scores settings and the experiments
 * list also render. The coding-agent, dataset and annotation web packages each
 * already carry their own; this is the fourth, for the same reason and with the
 * same shape.
 */

import { Center, EmptyState, Icon, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

export function NoDataInfoBlock({
  title,
  description,
  icon,
  docsInfo,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  docsInfo?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Center flex={1} padding={6}>
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <Icon size="lg">{icon}</Icon>
          </EmptyState.Indicator>
          <EmptyState.Title>{title}</EmptyState.Title>
          {/* EmptyState.Description renders a <p>, so anything block-level
              (docsInfo, children) must sit beside it, not inside it. */}
          <EmptyState.Description>{description}</EmptyState.Description>
          {(docsInfo ?? children) != null && (
            <VStack align="center" textStyle="sm" color="fg.muted">
              {docsInfo}
              {children}
            </VStack>
          )}
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
}
