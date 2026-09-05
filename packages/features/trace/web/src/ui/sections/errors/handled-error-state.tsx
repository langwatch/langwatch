import { Box, Heading, List, Stack, Text, VStack } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

import { resolveErrorCopy } from "../../../behavior/errors/logic/resolve-error-copy";

import { ErrorActions } from "../../elements/errors/error-actions";

export interface HandledErrorStateProps {
  /** Any error — handled or not. */
  error: unknown;
  /** Headline for a failure with no registry copy. */
  fallbackTitle?: string;
  /** Hard override of the title. Rare. */
  title?: string;
  /**
   * The glyph above the headline. Defaults to the same alert mark the inline
   * variant uses; pass a softer one (a ghost, a magnifier) where the page is
   * a dead end rather than a fault.
   */
  icon?: ReactNode;
  /** Buttons, links, an invitation to sign up — whatever the way forward is. */
  children?: ReactNode;
  /** Fill the viewport. Off inside a layout that already owns the height. */
  fullHeight?: boolean;
}

/**
 * A whole page that failed, told the way the 404 page tells it.
 */
export function HandledErrorState({
  error,
  title,
  fallbackTitle,
  icon,
  children,
  fullHeight = true,
}: HandledErrorStateProps) {
  const copy = resolveErrorCopy({ error, title, fallbackTitle });

  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="center"
      width="full"
      padding={8}
      {...(fullHeight ? { minHeight: "100vh" } : { paddingY: 16 })}
    >
      <VStack gap={4} maxWidth="560px" textAlign="center">
        <Box color="fg.muted" aria-hidden="true">
          {icon ?? <AlertCircle size={44} strokeWidth={1.5} />}
        </Box>

        {/* `role="alert"` on the text, not the whole box: a screen reader
            should hear what went wrong, not the decoration around it. */}
        <Stack gap={2} role="alert">
          <Heading size="lg" letterSpacing="-0.01em">
            {copy.title}
          </Heading>
          {copy.description && (
            <Text color="fg.muted" fontSize="15px" lineHeight="1.6">
              {copy.description}
            </Text>
          )}
        </Stack>

        {copy.tips.length > 0 && (
          <List.Root gap={1} fontSize="13.5px" color="fg.muted" textAlign="left" paddingLeft={4}>
            {/* Index key: tips are server-supplied prose, so two can be
                identical and collide as keys. Their order is fixed. */}
            {copy.tips.map((tip, index) => (
              <List.Item key={index}>{tip}</List.Item>
            ))}
          </List.Root>
        )}

        {/*
          A column, not a row: the way forward is sometimes one button and
          sometimes a whole invitation with a rule across it, and a row would
          squash the second into a gutter. Callers that want their actions
          side by side put their own `HStack` in here.
        */}
        {children && (
          <VStack gap={3} paddingTop={2} width="full" align="center">
            {children}
          </VStack>
        )}

        <ErrorActions docsUrl={copy.docsUrl} traceId={copy.traceId} />
      </VStack>
    </Box>
  );
}
