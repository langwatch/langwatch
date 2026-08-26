import { Box, Button, Icon, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuFileText } from "react-icons/lu";
import { RenderedMarkdown } from "../markdown/rendered-markdown";
import { asMarkdownBody } from "./content-format";

export function ContextDisclosure({ context }: { context: string }) {
  const [open, setOpen] = useState(false);
  const snippet = useMemo(() => {
    const flat = context.replace(/\s+/g, " ").trim();
    return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
  }, [context]);

  return (
    <Box>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        paddingX={2}
        paddingY={1}
        height="auto"
        color="fg.subtle"
        _hover={{ color: "fg.muted", bg: "bg.muted" }}
      >
        <Icon as={open ? LuChevronDown : LuChevronRight} boxSize={3} marginEnd={1} />
        <Icon as={LuFileText} boxSize={3} marginEnd={1.5} />
        <Text textStyle="xs" fontWeight="500">
          {open ? "Hide additional context" : "Hidden additional context"}
        </Text>
      </Button>
      {!open && (
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono" paddingX={2} truncate>
          {snippet}
        </Text>
      )}
      {open && (
        <Box textStyle="xs" color="fg.muted" lineHeight="1.6" paddingTop={1}>
          <RenderedMarkdown
            markdown={asMarkdownBody(context)}
            paddingX={0}
            paddingY={0}
          />
        </Box>
      )}
    </Box>
  );
}
