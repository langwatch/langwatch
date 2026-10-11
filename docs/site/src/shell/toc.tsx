import { Box, Text } from "@langwatch/design-system/primitives";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type TocEntry = { depth: number; text: string; id: string };

function useActiveId({ entries }: { entries: TocEntry[] }) {
  const [active, setActive] = useState(entries[0]?.id ?? "");
  useEffect(() => {
    const elements = entries.map((entry) => document.getElementById(entry.id)).filter((node): node is HTMLElement => node !== null);
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

function TocLinks({ entries, active, onChoose }: { entries: TocEntry[]; active: string; onChoose?: () => void }) {
  return (
    <Box as="ul" margin="0" padding="0">
      {entries.map((entry) => {
        const current = entry.id === active;
        return (
          <Box as="li" key={entry.id} listStyleType="none">
            <Box
              as="a"
              href={`#${entry.id}`}
              onClick={onChoose}
              aria-current={current ? "location" : undefined}
              display="block"
              paddingY="2"
              fontSize="13px"
              lineHeight="20px"
              textDecoration="none"
              color={current ? "fg" : "fg.muted"}
              fontWeight={current ? "600" : "400"}
              boxShadow={current ? "inset 2px 0 0 var(--chakra-colors-accent-solid)" : "inset 1px 0 0 var(--chakra-colors-border-muted)"}
              _hover={{ color: "fg", textDecoration: "none" }}
              paddingInlineStart={entry.depth > 2 ? "6" : "3"}
            >
              {entry.text}
            </Box>
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
    <Box as="nav" aria-label="On this page">
      <Text margin="0" paddingBottom="2" fontSize="12px" lineHeight="20px" fontWeight="600">
        On this page
      </Text>
      <TocLinks entries={entries} active={active} />
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
      ref={ref}
      marginBottom="6"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      display={always ? "block" : { base: "block", xl: "none" }}
      css={{ "& > summary::-webkit-details-marker": { display: "none" }, "&[open] .docs-toc-chevron": { transform: "rotate(180deg)" } }}
    >
      <Box as="summary" display="flex" alignItems="center" justifyContent="space-between" minHeight="44px" paddingX="4" cursor="pointer" fontSize="14px" fontWeight="500" listStyle="none">
        On this page
        <ChevronDown size={16} className="docs-toc-chevron" aria-hidden="true" />
      </Box>
      <Box paddingX="2" paddingBottom="2">
        <TocLinks entries={entries} active={active} onChoose={() => ref.current?.removeAttribute("open")} />
      </Box>
    </Box>
  );
}
