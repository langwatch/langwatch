/**
 * The one empty state: icon, title, one sentence, at most one call to action. It owns its
 * height and centres itself, so a page never wraps it in a Center or pads it.
 * `page` fills a list page's body; `inline` sits in a settings band or under a table header.
 */
import { Box, Center, EmptyState, Icon, Link, VStack } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

export type NoDataInfoBlockSize = "page" | "inline";

export interface NoDataInfoBlockProps {
  title: string;
  description: string;
  icon: ReactNode;
  /** `page` (default) fills the body; `inline` is a bordered box inside a section. */
  size?: NoDataInfoBlockSize;
  /**
   * The one way in: a solid Button. Leave it out when the page header already shows
   * the same primary action; two buttons for one act compete.
   */
  primaryAction?: ReactNode;
  /** A quieter second way (a ghost Button or a link), beside the primary. */
  secondaryAction?: ReactNode;
  /** A docs page; rendered as "Read the docs" opening in a new tab. */
  docsHref?: string;
  /** Inline only: drop the border when the box already sits inside a Card. */
  bordered?: boolean;
  /** @deprecated pass `docsHref`. Rendered under the description as before. */
  docsInfo?: ReactNode;
  /** @deprecated pass `primaryAction` and `secondaryAction`. Rendered as before. */
  children?: ReactNode;
  /** @deprecated ignored; the block has one colour. */
  color?: string;
  testId?: string;
}

const PAGE = { minHeight: "320px", flex: 1, alignSelf: "stretch", padding: 6 } as const;
const INLINE = {
  minHeight: "160px",
  width: "full",
  paddingY: 6,
  paddingX: 5,
  borderColor: "border.muted",
  borderRadius: "md",
} as const;

export const NoDataInfoBlock = ({
  title,
  description,
  icon,
  size = "page",
  primaryAction,
  secondaryAction,
  docsHref,
  bordered = true,
  docsInfo,
  children,
  testId,
}: NoDataInfoBlockProps) => {
  const inline = size === "inline";
  const actions = primaryAction ?? secondaryAction;
  const legacy = docsInfo ?? children;
  return (
    <Center
      data-testid={testId}
      data-size={size}
      {...(inline ? { ...INLINE, borderWidth: bordered ? "1px" : 0 } : PAGE)}
    >
      <EmptyState.Root size={inline ? "sm" : "md"} padding={0}>
        <EmptyState.Content gap={inline ? 3 : 4} textAlign="center">
          <EmptyState.Indicator color="fg.muted">
            <Icon size={inline ? "md" : "lg"}>{icon}</Icon>
          </EmptyState.Indicator>
          <VStack gap={1} textAlign="center">
            <EmptyState.Title textStyle={inline ? "sm" : "md"} fontWeight="semibold">
              {title}
            </EmptyState.Title>
            {/* Description renders a <p>: block-level actions sit beside it, not in it. */}
            <EmptyState.Description
              textStyle="sm"
              color="fg.muted"
              maxWidth="400px"
              textWrap="balance"
            >
              {description}
            </EmptyState.Description>
          </VStack>
          {actions != null && (
            <Box display="flex" gap={2} justifyContent="center" flexWrap="wrap" paddingTop={1}>
              {primaryAction}
              {secondaryAction}
            </Box>
          )}
          {docsHref && (
            <Link
              href={docsHref}
              target="_blank"
              rel="noopener noreferrer"
              textStyle="sm"
              color="fg.muted"
              _hover={{ color: "fg" }}
            >
              Read the docs
              <ExternalLink size={12} aria-hidden />
            </Link>
          )}
          {legacy != null && (
            <VStack align="center" textStyle="sm" color="fg.muted">
              {docsInfo}
              {children}
            </VStack>
          )}
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
};
