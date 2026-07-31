import { Box, Heading, List, Stack, Text, VStack } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

import { resolveErrorCopy } from "../logic/resolveErrorCopy";

import { ErrorActions } from "./ErrorActions";

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
 *
 * The third error surface, after the toast (something just happened) and
 * `HandledErrorAlert` (a region of a page is still broken). This one is for
 * when there IS no page — the workflow is gone, the share link is dead — and
 * the alert is the only thing to look at.
 *
 * It exists because using the inline alert for that read as damage: a thin
 * red-hairline bar pinned to the top-left of an otherwise blank screen, or
 * floating in the middle of one, with no way onward. The same words in the
 * shape the app already uses for "page not found" — centred, a muted glyph, a
 * heading, and an action — read as a considered state instead of a stack
 * trace that happened to have a sentence in it.
 *
 * Copy still comes from the registry keyed by `code`, and the error id still
 * rides along: the affordance is the same everywhere, only the setting changes.
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
          <List.Root
            gap={1}
            fontSize="13.5px"
            color="fg.muted"
            textAlign="left"
            paddingLeft={4}
          >
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
