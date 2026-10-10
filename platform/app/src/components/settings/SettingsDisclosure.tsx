import { Box, Button, Collapsible } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** Keeps secondary guidance collapsed until its summary is opened. */
export function SettingsDisclosure({
  summary,
  children,
  variant = "default",
}: {
  /** The line on the trigger. Say what is inside, not "more". */
  summary: string;
  children: ReactNode;
  variant?: "default" | "prose";
}) {
  const prose = variant === "prose";

  return (
    <Collapsible.Root
      fontSize={prose ? "sm" : void 0}
      color={prose ? "fg.muted" : void 0}
      maxWidth={prose ? "72ch" : void 0}
    >
      <Collapsible.Trigger asChild>
        <Button
          variant="ghost"
          size="xs"
          paddingX={0}
          colorPalette={prose ? "orange" : void 0}
          color={prose ? "colorPalette.fg" : "fg.muted"}
          fontSize={prose ? "sm" : void 0}
          height={prose ? "auto" : void 0}
          fontWeight={prose ? "normal" : 500}
          alignSelf="start"
          _hover={
            prose
              ? { textDecoration: "underline", background: "transparent" }
              : { color: "fg" }
          }
        >
          {/* Collapsible puts its state on the trigger, not the icon. */}
          <Box
            asChild
            transition="transform 0.15s ease"
            css={{ "[data-state=open] &": { transform: "rotate(90deg)" } }}
          >
            <ChevronRight size={14} />
          </Box>
          {summary}
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Box
          paddingTop={2}
          paddingLeft={3}
          marginLeft="7px"
          borderLeftWidth="1px"
          borderColor="border.muted"
        >
          {children}
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
