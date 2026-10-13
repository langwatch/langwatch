import { Button, HStack } from "@chakra-ui/react";
import { Inbox, SearchX } from "lucide-react";

import { Banner, BannerAction } from "../../states/banner.tsx";
import {
  EmptyNextSteps,
  type EmptyNext,
  NoDataInfoBlock,
} from "../../states/no-data-info-block.tsx";
import { SpanRow } from "./parts.tsx";

export interface ListTableEmptyRowProps {
  columns: number;
  state: "empty" | "no-results" | "error";
  /** "No keys yet", "No keys match this scope", "Keys could not be loaded". */
  title: string;
  /** One sentence: why, or what happens next. */
  description?: string;
  /** Required: a setting, the docs or a prompt for a coding agent. */
  next: EmptyNext;
  /** No-results only: "Clear filters" beside the next step. */
  onClearFilters?: () => void;
  /** Error only: "Try again" beside the next step. */
  onRetry?: () => void;
  /** `row` (default): one compact line; `block`: an inline empty state for a big table. */
  size?: "row" | "block";
}

const ICON = { empty: Inbox, "no-results": SearchX } as const;

/** One row, three states, and a required next step. Failures are a Banner, never a quiet line. */
export function EmptyRow(props: ListTableEmptyRowProps) {
  return (
    <SpanRow columns={props.columns} data-empty-row={props.state}>
      <EmptyRowBody {...props} />
    </SpanRow>
  );
}

function EmptyRowBody({
  state,
  title,
  description,
  next,
  onClearFilters,
  onRetry,
  size = "row",
}: ListTableEmptyRowProps) {
  if (state === "error") {
    return (
      <Banner
        status="error"
        title={title}
        action={
          <HStack gap={3} wrap="wrap">
            {onRetry && <BannerAction onClick={onRetry}>Try again</BannerAction>}
            <EmptyNextSteps next={next} />
          </HStack>
        }
      >
        {description}
      </Banner>
    );
  }
  if (size === "block") {
    return (
      <BlockState
        state={state}
        title={title}
        description={description}
        next={next}
        onClearFilters={onClearFilters}
      />
    );
  }
  return (
    <HStack paddingX={4} paddingY={1}>
      <NoDataInfoBlock
        size="line"
        title={description ? `${title}. ${description}` : title}
        action={
          state === "no-results" && onClearFilters
            ? { label: "Clear filters", onClick: onClearFilters }
            : undefined
        }
        next={next}
      />
    </HStack>
  );
}

function BlockState({
  state,
  title,
  description,
  next,
  onClearFilters,
}: Pick<ListTableEmptyRowProps, "title" | "description" | "next" | "onClearFilters"> & {
  state: "empty" | "no-results";
}) {
  const Glyph = ICON[state];
  return (
    <NoDataInfoBlock
      size="inline"
      bordered={false}
      icon={<Glyph aria-hidden />}
      title={title}
      description={description ?? ""}
      next={next}
      secondaryAction={
        state === "no-results" && onClearFilters ? (
          <Button type="button" variant="plain" size="sm" color="fg" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}
