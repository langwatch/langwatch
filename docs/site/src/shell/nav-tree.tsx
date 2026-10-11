import { Box, chakra, Flex, Text } from "@langwatch/design-system/primitives";
import nav from "virtual:docs-nav";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ownsSlug } from "../lib/nav-model.ts";
import type { NavItem } from "../lib/nav-model.ts";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const METHOD_PALETTE: Record<string, string> = { GET: "green", POST: "blue", PUT: "yellow", PATCH: "yellow", DELETE: "red" };

function methodOf({ slug }: { slug: string }): string | null {
  const first = nav.pages[slug]?.openapi.split(/\s+/)[0]?.toUpperCase() ?? "";
  return METHODS.includes(first) ? first : null;
}

function indent({ depth }: { depth: number }) {
  return `calc(0.75rem + ${Math.min(Math.max(depth - 1, 0), 3) * 0.75}rem)`;
}

function NavMethod({ method }: { method: string }) {
  const palette = METHOD_PALETTE[method] ?? "gray";
  return (
    <Text
      as="span"
      flexShrink={0}
      minWidth="2.75rem"
      textAlign="center"
      paddingX="1"
      borderRadius="xs"
      bg={`${palette}.subtle`}
      color={`${palette}.fg`}
      fontFamily="mono"
      fontSize="10px"
      lineHeight="16px"
      fontWeight="600"
    >
      {method === "DELETE" ? "DEL" : method}
    </Text>
  );
}

function PageRow({ item, current, depth }: { item: Extract<NavItem, { type: "page" }>; current: string; depth: number }) {
  const active = item.slug === current;
  const method = methodOf({ slug: item.slug });
  return (
    <Box as="li" listStyleType="none">
      <chakra.a
        href={`/${item.slug}`}
        aria-current={active ? "page" : undefined}
        display="flex"
        gap="2"
        alignItems="baseline"
        minHeight={{ base: "44px", lg: "36px" }}
        paddingY="2"
        paddingX="3"
        paddingInlineStart={indent({ depth })}
        borderRadius="full"
        fontSize="14px"
        lineHeight="20px"
        textDecoration="none"
        color={active ? "accent.fg" : "nav.fg"}
        fontWeight={active ? "600" : "400"}
        bg={active ? "accent.subtle" : undefined}
        _hover={{ bg: active ? "accent.subtle" : "bg.hover", textDecoration: "none" }}
      >
        {method ? <NavMethod method={method} /> : null}
        <span>{item.title}</span>
      </chakra.a>
    </Box>
  );
}

function GroupRow({ item, current, depth }: { item: Extract<NavItem, { type: "group" }>; current: string; depth: number }) {
  const active = ownsSlug({ items: item.children, slug: current });
  const [open, setOpen] = useState(active);
  if (depth === 0) {
    return (
      <Box as="li" listStyleType="none" marginTop="6" css={{ "&:first-of-type": { marginTop: "0" } }}>
        <Text as="h2" margin="0" paddingX="3" paddingBottom="2" fontSize="12px" lineHeight="16px" fontWeight="600" color="fg">
          {item.title}
        </Text>
        <NavList items={item.children} current={current} depth={1} />
      </Box>
    );
  }
  return (
    <Box as="li" listStyleType="none">
      <chakra.button
        type="button"
        display="flex"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        width="100%"
        alignItems="center"
        justifyContent="space-between"
        gap="2"
        minHeight={{ base: "44px", lg: "36px" }}
        paddingY="2"
        paddingX="3"
        paddingInlineStart={indent({ depth })}
        borderRadius="full"
        fontSize="14px"
        lineHeight="20px"
        fontWeight="500"
        color="nav.fg"
        textAlign="start"
        cursor="pointer"
        _hover={{ bg: "bg.hover" }}
      >
        <span>{item.title}</span>
        <ChevronRight size={14} aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : undefined, flexShrink: 0 }} />
      </chakra.button>
      <Box hidden={!open} data-docs-panel="">
        <NavList items={item.children} current={current} depth={depth + 1} />
      </Box>
    </Box>
  );
}

function NavList({ items, current, depth }: { items: NavItem[]; current: string; depth: number }) {
  return (
    <Box as="ul" margin="0" padding="0">
      {items.map((item) =>
        item.type === "page" ? (
          <PageRow key={item.slug} item={item} current={current} depth={depth} />
        ) : (
          <GroupRow key={item.title} item={item} current={current} depth={depth} />
        ),
      )}
    </Box>
  );
}

/** The active section's tree; only groups holding the current page start open. */
export function NavTree({ items, current, id }: { items: NavItem[]; current: string; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-docs-scroll]");
    const row = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !row) return;
    const offset = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (offset > scroller.clientHeight - 80 || offset < 0) scroller.scrollTop += offset - scroller.clientHeight / 3;
  }, []);
  return (
    <Box as="nav" id={id} tabIndex={id ? -1 : undefined} aria-label="Page navigation" ref={ref}>
      <NavList items={items} current={current} depth={0} />
    </Box>
  );
}
