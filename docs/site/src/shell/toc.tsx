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

function TocLinks({
  entries,
  active,
  onChoose,
}: {
  entries: TocEntry[];
  active: string;
  onChoose?: () => void;
}) {
  return (
    <Box as="ul" margin="0" padding="0">
      {entries.map((entry) => {
        const current = entry.id === active;
        return (
          <Box as="li" key={entry.id} listStyleType="none">
            <chakra.a
              href={`#${entry.id}`}
              data-depth={entry.depth}
              onClick={onChoose}
              aria-current={current ? "location" : undefined}
              display="block"
              paddingY="1"
              fontSize="13px"
              lineHeight="21px"
              textDecoration="none"
              color={current ? "accent.fg" : "docs.contents"}
              fontWeight={current ? "600" : "400"}
              _hover={{ color: "fg", textDecoration: "none" }}
              paddingInlineStart={entry.depth > 2 ? "3" : "0"}
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
      marginBottom="6"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
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
        justifyContent="space-between"
        minHeight="44px"
        paddingX="4"
        cursor="pointer"
        fontSize="14px"
        fontWeight="500"
        listStyle="none"
      >
        On this page
        <ChevronDown size={16} className="docs-toc-chevron" aria-hidden="true" />
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
