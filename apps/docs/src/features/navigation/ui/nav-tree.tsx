import { Box, chakra, Text } from "@langwatch/design-system/primitives";

import { isColourLogo } from "../../../lib/logos.ts";
import { pagePath, sitePath } from "../../../lib/site-path.ts";
import { Icon } from "../../content/ui.ts";
import { endpointCount, groupTarget, methodOf, soleChild, startsOpen } from "../model/nav.ts";
import type { NavItem, PageMeta } from "../model/nav.ts";

type Pages = Record<string, PageMeta>;

type Group = Extract<NavItem, { type: "group" }>;

const METHOD_PALETTE: Record<string, string> = {
  GET: "green",
  POST: "blue",
  PUT: "yellow",
  PATCH: "yellow",
  DELETE: "red",
};
/* Rows keep one inline padding; nesting comes from panels, whose rule is the guide line. */
const ROW_PADDING = "10px";
const GUIDE_OFFSET = "13px";
const GUIDE_GAP = "6px";

function NavMethod({ method }: { method: string }) {
  const palette = METHOD_PALETTE[method] ?? "gray";
  return (
    <Text
      as="span"
      className="docs-method-badge"
      data-method={method}
      flexShrink={0}
      minWidth="2.25rem"
      textAlign="center"
      paddingX="1"
      borderRadius="sm"
      bg={`${palette}.subtle`}
      color={`${palette}.fg`}
      fontFamily="mono"
      fontSize="10px"
      lineHeight="16px"
      fontWeight="600"
      marginTop="2px"
    >
      {method === "DELETE" ? "DEL" : method}
    </Text>
  );
}

/** Dark brand marks sit on a light chip so they stay legible on the dark sidebar. */
function NavGlyph({ icon }: { icon: string }) {
  if (!icon.startsWith("/")) {
    return (
      <Box as="span" display="inline-flex" marginTop="2px">
        <Icon icon={icon} size={16} />
      </Box>
    );
  }
  const colour = isColourLogo({ icon });
  return (
    <Box
      as="span"
      className="docs-nav-logo"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      width="20px"
      height="20px"
      borderRadius="5px"
      bg={colour ? void 0 : "docs.logoChip"}
      boxShadow={colour ? void 0 : "inset 0 0 0 1px {colors.docs.logoChipRing}"}
    >
      <img
        src={sitePath({ path: icon })}
        alt=""
        width={16}
        height={16}
        loading="lazy"
        decoding="async"
        style={{ objectFit: "contain" }}
      />
    </Box>
  );
}

/** `group` is set when a one-page group shows as its page: the row takes the group's name. */
function PageRow({
  item,
  pages,
  current,
  nested,
  group,
  depth = 1,
}: {
  item: Extract<NavItem, { type: "page" }>;
  pages: Pages;
  current: string;
  nested: boolean;
  group?: Group;
  depth?: number;
}) {
  const active = item.slug === current;
  const meta = pages[item.slug];
  const method = methodOf({ meta });
  const glyph = group?.icon || meta?.icon || meta?.logo;
  const title = group?.title ?? item.title;
  const heading = Boolean(group) && depth === 0;
  return (
    <li style={heading ? { marginTop: "16px" } : undefined}>
      <chakra.a
        href={pagePath({ slug: item.slug })}
        aria-current={active ? "page" : undefined}
        position="relative"
        display="flex"
        gap="2"
        alignItems="flex-start"
        minHeight={{ base: "44px", lg: "36px" }}
        paddingY="2"
        paddingX={ROW_PADDING}
        borderRadius="sm"
        fontSize="14px"
        lineHeight="20px"
        textDecoration="none"
        color={heading ? "fg" : "nav.fg"}
        fontWeight={heading ? "600" : "400"}
        _hover={{ bg: "bg.hover", textDecoration: "none" }}
        _currentPage={{ color: "accent.fg", fontWeight: "600", bg: "accent.subtle" }}
        _before={
          nested && active
            ? {
                content: '""',
                position: "absolute",
                insetInlineStart: `calc(-${GUIDE_GAP} - 2px)`,
                top: "6px",
                bottom: "6px",
                width: "2px",
                borderRadius: "full",
                bg: "accent.fg",
              }
            : undefined
        }
      >
        {method ? <NavMethod method={method} /> : null}
        {!method && glyph ? <NavGlyph icon={glyph} /> : null}
        <span className="docs-nav-label" title={title}>
          {title}
        </span>
      </chakra.a>
    </li>
  );
}

function GroupRow({
  item,
  pages,
  current,
  depth,
  trail,
}: {
  item: Group;
  pages: Pages;
  current: string;
  depth: number;
  trail: string;
}) {
  const open = startsOpen({ group: item, slug: current, pages });
  const [slug = "", hash] = groupTarget({ group: item }).split("#");
  const endpoints = endpointCount({ group: item, pages });
  const key = `${trail}/${item.title}`;
  return (
    <Box
      as="li"
      listStyleType="none"
      display="grid"
      gridTemplateColumns="minmax(0, 1fr) auto"
      alignItems="start"
      marginTop={depth === 0 ? "4" : "0"}
    >
      <chakra.a
        href={`${pagePath({ slug })}${hash ? `#${hash}` : ""}`}
        aria-current={item.root === current ? "page" : undefined}
        display="flex"
        gap="2"
        alignItems="flex-start"
        minWidth="0"
        minHeight={{ base: "44px", lg: "36px" }}
        paddingY="2"
        paddingX={ROW_PADDING}
        borderRadius="sm"
        fontSize="14px"
        lineHeight="20px"
        fontWeight={depth === 0 ? "600" : "500"}
        color={depth === 0 ? "fg" : "nav.fg"}
        textDecoration="none"
        _hover={{ bg: "bg.hover", textDecoration: "none" }}
        _currentPage={{ color: "accent.fg", bg: "accent.subtle" }}
      >
        {item.icon ? <NavGlyph icon={item.icon} /> : null}
        <span className="docs-nav-label" title={item.title}>
          {item.title}
        </span>
        {endpoints > 0 ? (
          <Text
            as="span"
            title={`${endpoints} endpoints`}
            marginInlineStart="auto"
            marginTop="1px"
            flexShrink={0}
            minWidth="20px"
            paddingX="1.5"
            borderRadius="full"
            bg="bg.subtle"
            color="fg.muted"
            fontFamily="mono"
            fontSize="11px"
            lineHeight="18px"
            fontWeight="500"
            textAlign="center"
          >
            {endpoints}
          </Text>
        ) : null}
      </chakra.a>
      <chakra.button
        type="button"
        aria-expanded={open}
        aria-label={`${item.title} pages`}
        data-docs-group={key}
        display="flex"
        alignItems="center"
        justifyContent="center"
        width={{ base: "44px", lg: "28px" }}
        minHeight={{ base: "44px", lg: "36px" }}
        borderRadius="sm"
        color="fg.muted"
        cursor="pointer"
        _hover={{ bg: "bg.hover", color: "fg" }}
      >
        <span className="docs-nav-chevron" aria-hidden="true" />
      </chakra.button>
      <Box
        hidden={!open}
        data-docs-panel=""
        gridColumn="1 / -1"
        borderInlineStartWidth="1px"
        borderColor="border"
        marginInlineStart={GUIDE_OFFSET}
        paddingInlineStart={GUIDE_GAP}
        marginTop="0.5"
        marginBottom="1"
      >
        <NavList
          items={item.children}
          pages={pages}
          current={current}
          depth={depth + 1}
          trail={key}
        />
      </Box>
    </Box>
  );
}

function NavList({
  items,
  pages,
  current,
  depth,
  trail,
}: {
  items: NavItem[];
  pages: Pages;
  current: string;
  depth: number;
  trail: string;
}) {
  return (
    <ul>
      {items.map((item) => {
        if (item.type === "page") {
          return (
            <PageRow
              key={item.slug}
              item={item}
              pages={pages}
              current={current}
              nested={depth > 0}
            />
          );
        }
        const only = soleChild({ group: item });
        return only ? (
          <PageRow
            key={item.title}
            item={only}
            pages={pages}
            group={item}
            current={current}
            nested={depth > 0}
            depth={depth}
          />
        ) : (
          <GroupRow
            key={item.title}
            item={item}
            pages={pages}
            current={current}
            depth={depth}
            trail={trail}
          />
        );
      })}
    </ul>
  );
}

/** The active section's tree. Group headers link to their page; the chevron opens the group. */
export function NavTree({
  items,
  pages,
  current,
  section,
  id,
}: {
  items: NavItem[];
  /** Each page's metadata by slug, as the navigation was compiled. */
  pages: Pages;
  current: string;
  section: string;
  id?: string;
}) {
  return (
    <Box
      as="nav"
      className="docs-nav-tree"
      position="relative"
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-label="Page navigation"
    >
      <NavList items={items} pages={pages} current={current} depth={0} trail={section} />
    </Box>
  );
}
