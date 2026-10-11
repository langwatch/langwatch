import { Box, Flex, Text } from "@langwatch/design-system/primitives";
import nav from "virtual:docs-nav";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ownsSlug } from "../lib/nav-model.ts";
import type { NavItem } from "../lib/nav-model.ts";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function methodOf({ slug }: { slug: string }): string | null {
  const first = nav.pages[slug]?.openapi.split(/\s+/)[0]?.toUpperCase() ?? "";
  return METHODS.includes(first) ? first : null;
}

function indent({ depth }: { depth: number }) {
  return `calc(0.75rem + ${Math.min(Math.max(depth - 1, 0), 3) * 0.75}rem)`;
}

function PageRow({ item, current, depth }: { item: Extract<NavItem, { type: "page" }>; current: string; depth: number }) {
  const active = item.slug === current;
  const method = methodOf({ slug: item.slug });
  return (
    <Box as="li" listStyleType="none">
      <Box
        as="a"
        href={`/${item.slug}`}
        aria-current={active ? "page" : undefined}
        display="flex"
        gap="2"
        alignItems="baseline"
        minHeight="36px"
        paddingY="2"
        paddingX="3"
        paddingInlineStart={indent({ depth })}
        borderRadius="md"
        fontSize="14px"
        lineHeight="20px"
        textDecoration="none"
        color={active ? "fg" : "nav.fg"}
        fontWeight={active ? "600" : "400"}
        bg={active ? "nav.bgActive" : undefined}
        boxShadow={active ? "inset 2px 0 0 var(--chakra-colors-accent-solid)" : undefined}
        _hover={{ bg: "nav.bgHover", textDecoration: "none" }}
      >
        {method ? (
          <Text as="span" fontFamily="mono" fontSize="10px" fontWeight="600" color="fg.muted" flexShrink={0} minWidth="2.4em">
            {method === "DELETE" ? "DEL" : method}
          </Text>
        ) : null}
        <span>{item.title}</span>
      </Box>
    </Box>
  );
}

function GroupRow({ item, current, depth }: { item: Extract<NavItem, { type: "group" }>; current: string; depth: number }) {
  const active = ownsSlug({ items: item.children, slug: current });
  const [open, setOpen] = useState(active);
  if (depth === 0) {
    return (
      <Box as="li" listStyleType="none" marginTop="6" css={{ "&:first-of-type": { marginTop: "0" } }}>
        <Text as="h2" margin="0" paddingX="3" paddingBottom="2" fontSize="12px" lineHeight="20px" fontWeight="600" color="fg.muted">
          {item.title}
        </Text>
        <NavList items={item.children} current={current} depth={1} />
      </Box>
    );
  }
  return (
    <Box as="li" listStyleType="none">
      <Flex
        as="button"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        width="100%"
        alignItems="center"
        gap="2"
        minHeight="36px"
        paddingY="2"
        paddingX="3"
        paddingInlineStart={indent({ depth })}
        borderRadius="md"
        fontSize="14px"
        lineHeight="20px"
        fontWeight="500"
        color="nav.fg"
        textAlign="start"
        cursor="pointer"
        _hover={{ bg: "nav.bgHover" }}
      >
        <ChevronRight size={14} aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : undefined, flexShrink: 0 }} />
        <span>{item.title}</span>
      </Flex>
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
export function NavTree({ items, current }: { items: NavItem[]; current: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-docs-scroll]");
    const row = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !row) return;
    const offset = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (offset > scroller.clientHeight - 80 || offset < 0) scroller.scrollTop += offset - scroller.clientHeight / 3;
  }, []);
  return (
    <Box as="nav" aria-label="Page navigation" ref={ref}>
      <NavList items={items} current={current} depth={0} />
    </Box>
  );
}
