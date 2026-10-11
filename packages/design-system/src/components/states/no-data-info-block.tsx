/**
 * The one empty state: icon, title, one sentence, at most one call to action; it owns its height.
 * `page` fills a list page's body; `inline` sits in a band or under a table header;
 * `line` is one muted sentence where a list or a picker is empty.
 */
import {
  Box,
  Button,
  Center,
  EmptyState,
  HStack,
  Icon,
  Link,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import { useCopyToClipboard } from "../../use-copy-to-clipboard.ts";

/** Where an empty state sends the reader: never a dead end. */
export type NoDataNext =
  | { kind: "setting"; label: string; href: string }
  | { kind: "docs"; label: string; href: string }
  /** Copies `prompt` so the reader can paste it into their coding agent. */
  | { kind: "agent-prompt"; prompt: string; label?: string }
  | { kind: "action"; label: string; onClick: () => void };

export type NoDataInfoBlockSize = "page" | "inline";

export interface NoDataInfoBlockBlockProps {
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
  /** The next step: a setting, a docs page, a prompt for a coding agent, or an action. */
  next?: NoDataNext;
  testId?: string;
}

/** One muted sentence where a list or a picker is empty: "No replicas found." */
export interface NoDataInfoBlockLineProps {
  size: "line";
  title: string;
  action?: { label: string; onClick: () => void };
  next?: NoDataNext;
  testId?: string;
}

export type NoDataInfoBlockProps = NoDataInfoBlockBlockProps | NoDataInfoBlockLineProps;

const PAGE = { minHeight: "320px", flex: 1, alignSelf: "stretch", padding: 6 } as const;
const INLINE = {
  minHeight: "160px",
  width: "full",
  paddingY: 6,
  paddingX: 5,
  borderColor: "border.muted",
  borderRadius: "md",
} as const;

export const NoDataInfoBlock = (props: NoDataInfoBlockProps) =>
  props.size === "line" ? <NoDataLine {...props} /> : <NoDataBlock {...props} />;

function NoDataNextStep({ next }: { next: NoDataNext }) {
  const { copied, copy } = useCopyToClipboard();
  if (next.kind === "action") {
    return (
      <Button type="button" variant="plain" size="sm" color="fg" onClick={next.onClick}>
        {next.label}
      </Button>
    );
  }
  if (next.kind === "agent-prompt") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-next="agent-prompt"
        onClick={() => copy(next.prompt)}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {copied ? "Copied" : (next.label ?? "Copy a prompt for your coding agent")}
      </Button>
    );
  }
  const docs = next.kind === "docs";
  return (
    <Link
      href={next.href}
      data-next={next.kind}
      textStyle="sm"
      color="fg.muted"
      _hover={{ color: "fg" }}
      {...(docs ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {next.label}
      {docs && <ExternalLink size={12} aria-hidden />}
    </Link>
  );
}

function NoDataLine({ title, action, next, testId }: NoDataInfoBlockLineProps) {
  return (
    <HStack gap={2} paddingY={2} data-testid={testId} data-size="line">
      <Text textStyle="sm" color="fg.muted">
        {title}
      </Text>
      {action && (
        <Button type="button" variant="plain" size="sm" color="fg" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {next && <NoDataNextStep next={next} />}
    </HStack>
  );
}

const NoDataBlock = ({
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
  next,
  testId,
}: NoDataInfoBlockBlockProps) => {
  const inline = size === "inline";
  const actions = primaryAction ?? secondaryAction ?? next;
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
              {next && <NoDataNextStep next={next} />}
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
