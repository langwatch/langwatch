import { Box, chakra, Text } from "@langwatch/design-system/primitives";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type TocEntry = { depth: number; text: string; id: string };

function useActiveId({ entries }: { entries: TocEntry[] }) {
  const [active, setActive] = useState(entries[0]?.id ?? "");
  useEffect(() => {
    const elements = entries
      .map((entry) => document.getElementById(entry.id))
      .filter((node): node is HTMLElement => node !== null);
    if (elements.length === 0) return;
    const update = () => {
      const line = window.innerHeight * 0.25;
      let current = elements[0].id;
      for (const element of elements) {
        if (element.getBoundingClientRect().top - line <= 0) current = element.id;
      }
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [entries]);
  return active;
}

/** An entry indents only beneath a shallower heading, so a page that opens with h3s and closes
    with an h2 keeps every entry on one edge. */
export function nestedEntries({ entries }: { entries: TocEntry[] }): boolean[] {
  return entries.map((entry, index) =>
    entries.slice(0, index).some((earlier) => earlier.depth < entry.depth),
  );
}

function TocLinks({
  entries,
  active,
  onChoose,
}: {
  entries: TocEntry[];
  active: string;
  onChoose?: () => void;
}) {
  const nested = nestedEntries({ entries });
  return (
    <Box as="ul" margin="0" padding="0">
      {entries.map((entry, index) => {
        const current = entry.id === active;
        return (
          <Box as="li" key={entry.id} listStyleType="none">
            <chakra.a
              href={`#${entry.id}`}
              data-depth={entry.depth}
              data-nested={nested[index] ? "true" : void 0}
              onClick={onChoose}
              aria-current={current ? "location" : undefined}
              display="block"
              paddingY="1"
              paddingInlineStart={nested[index] ? "3" : "0"}
              fontSize="13px"
              lineHeight="21px"
              fontWeight="450"
              textDecoration="none"
              color="docs.body"
              transition="color 120ms ease"
              _hover={{ color: "nav.fg", textDecoration: "none" }}
              css={{
                "&[aria-current=location], &[aria-current=location]:hover": { color: "accent.fg" },
              }}
            >
              {entry.text}
            </chakra.a>
          </Box>
        );
      })}
    </Box>
  );
}

/** Desktop rail. Omitted by the caller when fewer than two entries exist. */
export function TocRail({ entries }: { entries: TocEntry[] }) {
  const active = useActiveId({ entries });
  return (
    <Box as="nav" className="docs-toc-rail" aria-label="On this page" data-docs-toc="">
      <Text margin="0" paddingBottom="2" fontSize="14px" lineHeight="20px" fontWeight="500">
        On this page
      </Text>
      <Box className="docs-toc-track">
        <svg className="docs-toc-progress" aria-hidden="true" focusable="false">
          <path className="docs-toc-guide" />
          <path className="docs-toc-path" />
        </svg>
        <TocLinks entries={entries} active={active} />
      </Box>
    </Box>
  );
}

/** Inline disclosure below the page actions on compact screens and on endpoint pages. */
export function TocDisclosure({ entries, always }: { entries: TocEntry[]; always?: boolean }) {
  const active = useActiveId({ entries });
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <Box
      as="details"
      data-docs-toc=""
      ref={ref}
      className="docs-toc-disclosure"
      marginTop="4"
      marginBottom="6"
      display={always ? "block" : { base: "block", xl: "none" }}
      css={{
        "& > summary::-webkit-details-marker": { display: "none" },
        "&[open] .docs-toc-chevron": { transform: "rotate(180deg)" },
      }}
    >
      <Box
        as="summary"
        display="flex"
        alignItems="center"
        gap="2"
        minHeight="44px"
        cursor="pointer"
        fontSize="14px"
        fontWeight="500"
        listStyle="none"
      >
        <span>On this page</span>
        <span className="docs-toc-current" aria-hidden="true" />
        <ChevronDown size={16} className="docs-toc-chevron" aria-hidden="true" />
        <span className="docs-toc-bar" aria-hidden="true" />
      </Box>
      <Box paddingX="2" paddingBottom="2">
        <TocLinks
          entries={entries}
          active={active}
          onChoose={() => ref.current?.removeAttribute("open")}
        />
      </Box>
    </Box>
  );
}
