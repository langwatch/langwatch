import { Box, Flex, Tabs, Text } from "@langwatch/design-system/primitives";
import { FileCode } from "lucide-react";
import { Children, isValidElement, useState } from "react";
import type { ReactNode } from "react";

import { usePreference, writePreference } from "../../../lib/storage.ts";
import {
  codeFilename,
  type CodeSource,
  languageName,
  preferenceGroupFor,
  tabFamilies,
} from "../../code/model.ts";
import { CodeBar, CodeBody, CodeFrame, CopyAction, sourceFromProps } from "../../code/ui.ts";
import { readingTabList, readingTabTrigger, tabValue } from "./tabs.tsx";

type Item = { label: string; source?: CodeSource; content?: ReactNode };

function itemsOf({ children }: { children: ReactNode }): Item[] {
  return Children.toArray(children).flatMap((child): Item[] => {
    if (!isValidElement<{ title?: string; children?: ReactNode } & Record<string, unknown>>(child))
      return [];
    if (child.type === CodeGroupItem) {
      return [{ label: String(child.props.title ?? "Example"), content: child.props.children }];
    }
    const source = sourceFromProps(child.props);
    if (!source.code && !source.lines.length) return [];
    return [{ label: source.title || languageName({ lang: source.lang }), source }];
  });
}

/** One frame, authored tabs, one copy action; recognised label sets share a stored choice. */
export function CodeGroup({ children }: { children?: ReactNode }) {
  const items = itemsOf({ children });
  const authoredGroup = preferenceGroupFor({ labels: items.map((item) => item.label) });
  const group =
    authoredGroup ??
    preferenceGroupFor({
      labels: items.map((item) =>
        item.source ? languageName({ lang: item.source.lang }) : item.label,
      ),
    });
  const languageVariants = group === "sdk-language" || group === "api-language";
  const choiceOf = (item: Item) => {
    if (authoredGroup) return item.label;
    if (!languageVariants || !item.source) return item.label;
    return languageName({ lang: item.source.lang });
  };
  const families = tabFamilies({
    tabs: items.map((item) => [choiceOf(item), ...(item.source ? [item.source.lang] : [])]),
  });
  const stored = usePreference({ key: group });
  const [local, setLocal] = useState<string | null>(null);
  const labels = items.map((item) => item.label);
  const wanted = group ? stored : local;
  const active =
    items.find((item) => choiceOf(item).toLowerCase() === wanted?.toLowerCase())?.label ??
    labels[0];
  const current = items.find((item) => item.label === active) ?? items[0];
  if (!current) return null;
  return (
    <CodeFrame>
      <Tabs.Root
        data-docs-preference={group ?? void 0}
        value={active === undefined ? void 0 : tabValue({ label: active })}
        onValueChange={({ value }) => {
          const selected = items.find((item) => tabValue({ label: item.label }) === value);
          if (group) writePreference({ key: group, value: selected ? choiceOf(selected) : value });
          else setLocal(selected?.label ?? value);
        }}
        variant="line"
        colorPalette="accent"
        size="md"
      >
        <CodeBar>
          <FileCode size={16} aria-hidden="true" />
          <Text
            as="span"
            data-docs-code-title=""
            fontSize="12px"
            fontFamily="mono"
            minWidth="0"
            flex="1"
          >
            {current.source ? codeFilename(current.source) : current.label}
          </Text>
          <Flex alignItems="center" flexShrink={0}>
            {current.source ? <CopyAction code={current.source.code} /> : null}
          </Flex>
        </CodeBar>
        <CodeBar>
          <Tabs.List
            css={{
              ...readingTabList,
              flex: 1,
              minWidth: 0,
              borderBottomWidth: 0,
              boxShadow: "none",
            }}
          >
            {items.map((item, index) => (
              <Tabs.Trigger
                key={item.label}
                value={tabValue({ label: item.label })}
                data-docs-language={choiceOf(item)}
                data-docs-family={families[index] ?? void 0}
                css={{ ...readingTabTrigger, minHeight: "44px" }}
              >
                {choiceOf(item)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </CodeBar>
        {items.map((item) => (
          <Tabs.Content
            key={item.label}
            value={tabValue({ label: item.label })}
            padding="0"
            data-docs-panel=""
            data-code-title={item.source ? codeFilename(item.source) : item.label}
          >
            {item.source ? (
              <CodeBody source={item.source} />
            ) : (
              <Box padding="4">{item.content}</Box>
            )}
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </CodeFrame>
  );
}

/** Some pages nest `CodeGroupItem` around a fence; it renders the fence unchanged. */
export function CodeGroupItem({ children }: { children?: ReactNode; title?: string }) {
  return <>{children}</>;
}
