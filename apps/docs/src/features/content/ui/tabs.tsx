import type { SystemStyleObject } from "@langwatch/design-system/primitives";
import { Tabs as ChakraTabs, Text } from "@langwatch/design-system/primitives";
import { Children, isValidElement, useState } from "react";
import type { ReactNode } from "react";

import { usePreference, writePreference } from "../../../lib/storage.ts";
import { preferenceGroupFor } from "../../code/ui/languages.ts";

/** Docs reading treatment: neutral labels, a 2px accent underline, 44px triggers. */
export const readingTabList = {
  overflowX: "auto",
  minWidth: 0,
  maxWidth: "100%",
  paddingBottom: "0",
  flexWrap: "nowrap",
  scrollbarWidth: "thin",
} satisfies SystemStyleObject;

export const readingTabTrigger = {
  color: "fg.muted",
  fontWeight: "500",
  whiteSpace: "nowrap",
  flexShrink: 0,
  minHeight: "44px",
  paddingX: "3",
  fontSize: "14px",
  lineHeight: "20px",
  _hover: { color: "fg", bg: "bg.hover" },
  "&[data-selected]": { color: "fg", fontWeight: "600" },
} satisfies SystemStyleObject;

/** Authored tabs sit in one framed panel so their content reads as belonging to the strip. */
const FRAMED_TABS = {
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "xl",
  bg: "docs.raised",
  overflow: "hidden",
  boxShadow: "0 1px 2px var(--chakra-colors-docs-shadow)",
  "& > [data-docs-panel] > :first-child": { marginTop: "0" },
  "& > [data-docs-panel] > :last-child": { marginBottom: "0" },
} satisfies SystemStyleObject;

const FRAMED_LIST = {
  bg: "bg.subtle",
  paddingX: "2",
  paddingBottom: "0",
  borderBottomWidth: "1px",
  borderColor: "border",
  "& > [role=tab]": { borderTopRadius: "md", marginTop: "1.5" },
  "& > [role=tab][data-selected]": {
    bg: "docs.raised",
    boxShadow:
      "inset 1px 0 0 var(--chakra-colors-border), inset -1px 0 0 var(--chakra-colors-border)",
  },
  "& > [role=tab][data-selected]::before": {
    content: '""',
    position: "absolute",
    insetInline: "0",
    top: "auto",
    bottom: "-1px",
    height: "2px",
    borderRadius: "full",
    bg: "accent.solid",
  },
} satisfies SystemStyleObject;

type TabProps = { title?: string; children?: ReactNode };

/** A `Tabs` child: it only carries its title and content to the parent. */
export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

export function Tabs({ children }: { children?: ReactNode }) {
  const tabs = Children.toArray(children).flatMap((child, index) =>
    isValidElement<TabProps>(child)
      ? [{ label: child.props.title ?? `Tab ${index + 1}`, content: child.props.children }]
      : [],
  );
  const labels = tabs.map((tab) => tab.label);
  const group = preferenceGroupFor({ labels });
  const stored = usePreference({ key: group });
  const [local, setLocal] = useState<string | null>(null);
  const wanted = group ? stored : local;
  const active = labels.find((label) => label.toLowerCase() === wanted?.toLowerCase()) ?? labels[0];
  if (tabs.length === 0) return null;
  return (
    <ChakraTabs.Root
      data-docs-preference={group ?? void 0}
      value={active}
      onValueChange={({ value }) =>
        group ? writePreference({ key: group, value }) : setLocal(value)
      }
      variant="line"
      colorPalette="accent"
      minWidth="0"
      maxWidth="100%"
      marginY="6"
      className="docs-tabs"
      css={FRAMED_TABS}
    >
      <ChakraTabs.List
        css={{ ...readingTabList, ...FRAMED_LIST }}
        aria-description="Scroll horizontally for more tabs. Use arrow keys to change the selected tab."
      >
        {tabs.map((tab) => (
          <ChakraTabs.Trigger key={tab.label} value={tab.label} css={readingTabTrigger}>
            {tab.label}
          </ChakraTabs.Trigger>
        ))}
      </ChakraTabs.List>
      <Text
        className="docs-tab-hint"
        aria-hidden="true"
        fontSize="12px"
        color="docs.lede"
        margin="0"
        paddingX="4"
        paddingTop="2"
      >
        Scroll for more →
      </Text>
      {tabs.map((tab) => (
        <ChakraTabs.Content
          key={tab.label}
          value={tab.label}
          paddingX={{ base: "4", sm: "5" }}
          paddingTop="4"
          paddingBottom={{ base: "4", sm: "5" }}
          data-docs-panel=""
        >
          {tab.content}
        </ChakraTabs.Content>
      ))}
    </ChakraTabs.Root>
  );
}
