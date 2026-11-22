import { Flex, Tabs, Text, VisuallyHidden } from "@chakra-ui/react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { useIsDevelopment } from "../../../provider/environment.ts";
import { Tooltip } from "../../overlays/tooltip.tsx";
import { TriggerAnchor } from "../../overlays/trigger-anchor.tsx";
import { useProductAccent } from "../../scope/use-product-accent.ts";

/** One tab as the machine sees it: what the trigger shows, and the panel behind it. */
export interface TabsMachineItem<Value extends string> {
  value: Value;
  trigger: ReactNode;
  /** A disabled tab stays reachable by arrows, says why, and is never selected. */
  disabled?: { reason: string };
  shortcut?: string;
  /** One muted line at the top of the open panel; the panel's aria-describedby. */
  description?: string;
  panel: ReactNode;
  testId?: string;
}

export interface TabsMachineProps<Value extends string> {
  value: Value;
  onValueChange: (args: { value: Value }) => void;
  items: readonly TabsMachineItem<Value>[];
  label: string;
  /** `metric` triggers are a figure over a label; `code` sits in a code window's header. */
  look?: "content" | "metric" | "code";
  density?: "default" | "compact";
  body?: "padded" | "flush";
  inset?: "none" | "sm" | "md";
  scroll?: "page" | "panel" | "content";
  mount?: "lazy" | "active" | "all";
  activationMode?: "automatic" | "manual";
  panelHeader?: ReactNode;
  actions?: ReactNode;
  id?: string;
  testId?: string;
}

/** The one look switch for every content tab; the colour is the product's, from product-colours. */
export const CONTENT_TABS_LOOK = { variant: "line" } as const;

/** The list and panel side space: 16px for sm, 24px for md; the strip's rule stays full width. */
const SIDE_INSET = { none: 0, sm: 4, md: 6 } as const;

const TRIGGER_BASE = { flexShrink: 0, whiteSpace: "nowrap" } as const;
const TRIGGER_COMPACT = {
  height: "28px",
  minWidth: "28px",
  paddingX: "2",
  textStyle: "xs",
} as const;
const TRIGGER_METRIC = {
  height: "auto",
  paddingX: "0",
  paddingY: "3",
  marginEnd: { base: "6", md: "12" },
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "1",
  fontWeight: "normal",
} as const;

/**
 * Whether a panel's children exist: `all` always, `active` while open, `lazy` from the first
 * opening on. The shell around them is always there, so every tab has a valid `aria-controls`.
 */
function PanelBody({
  active,
  mount,
  children,
}: {
  active: boolean;
  mount: "lazy" | "active" | "all";
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(active);
  if (mount === "lazy" && active && !opened) setOpened(true);
  if (mount === "all") return children;
  if (mount === "active") return active ? children : null;
  return opened ? children : null;
}

function landing({ key, at, last }: { key: string; at: number; last: number }) {
  if (key === "ArrowLeft") return at === 0 ? last : at - 1;
  if (key === "ArrowRight") return at === last ? 0 : at + 1;
  if (key === "Home") return 0;
  return key === "End" ? last : undefined;
}

/** The tab an arrow, Home or End key lands on; automatic activation selects it (APG). */
function automaticTarget<Value extends string>({
  event,
  items,
}: {
  event: KeyboardEvent<HTMLElement>;
  items: readonly TabsMachineItem<Value>[];
}): TabsMachineItem<Value> | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined;
  const from = event.target instanceof HTMLElement ? event.target.closest("[role=tab]") : null;
  if (!(from instanceof HTMLElement)) return undefined;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role=tab]"));
  const to = landing({ key: event.key, at: tabs.indexOf(from), last: tabs.length - 1 });
  const landed = to === undefined ? undefined : tabs[to];
  return items.find((item) => item.value === landed?.dataset.value);
}

function Trigger<Value extends string>({
  item,
  panelId,
  reasonId,
  tabbable,
  look,
  density,
  last,
  onFocusTab,
}: {
  item: TabsMachineItem<Value>;
  panelId: string;
  reasonId: string;
  tabbable: boolean;
  look: "content" | "metric" | "code";
  density: "default" | "compact";
  last: boolean;
  onFocusTab: (value: string) => void;
}) {
  const compact = density === "compact" || look === "code";
  const trigger = (
    <Tabs.Trigger
      value={item.value}
      aria-controls={panelId}
      aria-disabled={item.disabled ? true : undefined}
      aria-describedby={item.disabled ? reasonId : undefined}
      aria-keyshortcuts={item.shortcut}
      data-disabled={item.disabled ? "" : undefined}
      data-testid={item.testId}
      tabIndex={tabbable ? 0 : undefined}
      onFocus={() => onFocusTab(item.value)}
      css={{
        ...TRIGGER_BASE,
        ...(compact ? TRIGGER_COMPACT : {}),
        ...(look === "metric" ? TRIGGER_METRIC : {}),
        ...(look === "metric" && last ? { marginEnd: "0" } : {}),
        ...(item.disabled ? { cursor: "not-allowed", opacity: 0.5 } : {}),
      }}
    >
      {item.trigger}
    </Tabs.Trigger>
  );
  if (!item.disabled) return trigger;
  return (
    <>
      <Tooltip content={item.disabled.reason} positioning={{ placement: "bottom" }}>
        <TriggerAnchor>{trigger}</TriggerAnchor>
      </Tooltip>
      <VisuallyHidden id={reasonId}>{item.disabled.reason}</VisuallyHidden>
    </>
  );
}

/** Development-only reports for a value no tab has and for duplicate values. */
function useTabsChecks({
  label,
  value,
  count,
  selected,
  duplicate,
}: {
  label: string;
  value: string;
  count: number;
  selected: boolean;
  duplicate: boolean;
}) {
  const isDevelopment = useIsDevelopment();
  useEffect(() => {
    if (!isDevelopment) return;
    if (duplicate) console.error(`Tabs "${label}" has duplicate values; the first of each shows.`);
    if (!selected && count > 0) {
      console.error(`Tabs "${label}" was given the value "${value}", which no tab has.`);
    }
  }, [isDevelopment, duplicate, selected, count, label, value]);
}

/**
 * Remembers the focused tab; when it leaves the items and focus fell to the page, puts focus
 * on the selected tab (else the first), never on `body`.
 */
function useFocusRescue<Value extends string>({
  items,
  selected,
  tabIdOf,
}: {
  items: readonly TabsMachineItem<Value>[];
  selected: Value | undefined;
  tabIdOf: (tab: string) => string;
}) {
  const lastFocused = useRef<string | null>(null);
  useEffect(() => {
    const last = lastFocused.current;
    if (last === null || items.some((item) => item.value === last)) return;
    lastFocused.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    const target = selected ?? items[0]?.value;
    if (target !== undefined) document.getElementById(tabIdOf(target))?.focus();
  });
  return {
    remember: (tab: string) => {
      lastFocused.current = tab;
    },
    forget: () => {
      lastFocused.current = null;
    },
  };
}

function rootCss({ compact, fills, look }: { compact: boolean; fills: boolean; look: string }) {
  return {
    "--tabs-height": compact ? "28px" : "32px",
    ...(fills ? { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } : {}),
    ...(look === "code"
      ? {
          borderWidth: "1px",
          borderColor: "border.muted",
          borderRadius: "md",
          overflow: "hidden",
          bg: "bg.panel",
        }
      : {}),
  } as const;
}

function Panel<Value extends string>({
  item,
  open,
  describedBy,
  panelCss,
  padding,
  mount,
}: {
  item: TabsMachineItem<Value>;
  open: boolean;
  describedBy: string;
  panelCss: object;
  padding: { top: number; bottom: number; x: number };
  mount: "lazy" | "active" | "all";
}) {
  return (
    <Tabs.Content
      value={item.value}
      hidden={!open}
      aria-describedby={open && item.description ? describedBy : undefined}
      paddingTop={padding.top}
      paddingBottom={padding.bottom}
      paddingX={padding.x}
      css={panelCss}
    >
      {open && item.description && (
        <Text id={describedBy} textStyle="xs" color="fg.muted" marginBottom={2}>
          {item.description}
        </Text>
      )}
      <PanelBody active={open} mount={mount}>
        {item.panel}
      </PanelBody>
    </Tabs.Content>
  );
}

function panelStyle(scroll: "page" | "panel" | "content") {
  return {
    "&[hidden]": { display: "none !important" },
    ...(scroll === "page" ? {} : { flex: "1 1 auto", minHeight: 0 }),
    ...(scroll === "panel" ? { overflowY: "auto" } : {}),
    ...(scroll === "content"
      ? { display: "flex", flexDirection: "column", overflow: "hidden" }
      : {}),
  } as const;
}

/**
 * The one tabs machine under ContentTabs, CodeTabs and MetricTabs: a controlled Chakra/Zag
 * tablist with stable panel shells, APG keys, and a disabled tab that stays reachable.
 */
export function TabsMachine<Value extends string>({
  value,
  onValueChange,
  items,
  label,
  look = "content",
  density = "default",
  body = "padded",
  inset = "none",
  scroll = "page",
  mount = "lazy",
  activationMode = "automatic",
  panelHeader,
  actions,
  id,
  testId,
}: TabsMachineProps<Value>) {
  const generated = useId();
  const accent = useProductAccent();
  const base = id ?? generated;
  const unique = items.filter(
    (item, index) => items.findIndex((other) => other.value === item.value) === index,
  );
  const selected = unique.find((item) => item.value === value);
  const tabIdOf = (tab: string) => `${base}-tab-${tab}`;
  const panelIdOf = (tab: string) => `${base}-panel-${tab}`;
  useTabsChecks({
    label,
    value,
    count: unique.length,
    selected: selected !== undefined,
    duplicate: unique.length !== items.length,
  });
  const focus = useFocusRescue({ items: unique, selected: selected?.value, tabIdOf });

  const compact = density === "compact" || look === "code";
  const gap = compact ? 3 : 4;
  const sideInset = SIDE_INSET[inset];
  const fills = scroll !== "page";
  const padded = body === "padded";
  const padding = {
    top: padded ? gap : 0,
    bottom: padded && fills ? gap : 0,
    x: sideInset,
  };

  return (
    <Tabs.Root
      value={value}
      onValueChange={(details) => {
        const item = unique.find((candidate) => candidate.value === details.value);
        if (item && !item.disabled) onValueChange({ value: item.value });
      }}
      ids={{ trigger: tabIdOf, content: panelIdOf }}
      // Zag only moves focus; automatic activation is the list's onKeyDown, the same everywhere.
      activationMode="manual"
      variant={CONTENT_TABS_LOOK.variant}
      colorPalette={accent.colorPalette}
      size="sm"
      loopFocus
      data-testid={testId}
      data-look={look}
      css={rootCss({ compact, fills, look })}
    >
      <Flex
        align="stretch"
        flexShrink={0}
        minWidth={0}
        paddingX={sideInset}
        borderBottomWidth="1px"
        borderColor={look === "code" ? "border.muted" : "border"}
      >
        <Tabs.List
          aria-label={label}
          flex="1 1 auto"
          minWidth={0}
          flexWrap="nowrap"
          borderBottomWidth={0}
          marginBottom="-1px"
          paddingBottom="1px"
          overflowX="auto"
          overflowY="hidden"
          css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
          onKeyDown={(event) => {
            if (activationMode !== "automatic") return;
            const target = automaticTarget({ event, items: unique });
            if (target && !target.disabled && target.value !== value) {
              onValueChange({ value: target.value });
            }
          }}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && !event.currentTarget.contains(next)) focus.forget();
          }}
        >
          {unique.map((item, at) => (
            <Trigger
              key={item.value}
              last={at === unique.length - 1}
              item={item}
              panelId={panelIdOf(item.value)}
              reasonId={`${base}-reason-${item.value}`}
              tabbable={!selected && unique[0]?.value === item.value}
              look={look}
              density={density}
              onFocusTab={focus.remember}
            />
          ))}
        </Tabs.List>
        {actions && (
          <Flex align="center" gap={2} flexShrink={0} paddingStart={2}>
            {actions}
          </Flex>
        )}
      </Flex>
      {panelHeader}
      {unique.map((item) => (
        <Panel
          key={item.value}
          item={item}
          open={item.value === selected?.value}
          describedBy={`${base}-description-${item.value}`}
          panelCss={panelStyle(scroll)}
          padding={padding}
          mount={mount}
        />
      ))}
    </Tabs.Root>
  );
}
