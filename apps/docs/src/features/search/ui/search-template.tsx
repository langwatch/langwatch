import {
  CommandBarFooter,
  CommandBarGroup,
  CommandBarInput,
  CommandBarItem,
} from "@langwatch/design-system/app-shell";
import { Box, Button, chakra, Text } from "@langwatch/design-system/primitives";
import { ArrowUpRight, FileText, Hash, Zap } from "lucide-react";

const ignore = () => {};
const noInput = { current: null };
/* The same block target every command bar row has always sat in. */
const ROW_TARGET = {
  display: "block",
  width: "100%",
  textAlign: "left",
  textDecoration: "none",
  tabIndex: -1,
} as const;

/**
 * The search command bar, drawn with the design system's own parts into every page. The search
 * island clones it into a native dialog and fills in the rows; nothing here renders until then,
 * and its styles reach the page stylesheet like any other prerendered markup.
 */
export function SearchTemplates() {
  return (
    <>
      <template id="docs-search-dialog">
        <chakra.dialog
          className="docs-search-dialog"
          aria-label="Search the LangWatch docs"
          background="docs.raised"
          color="fg"
          width={{ base: "calc(100vw - 24px)", md: "680px" }}
          maxWidth="680px"
          maxHeight="none"
          marginX="auto"
          marginTop={{ base: "8vh", md: "12vh" }}
          marginBottom="auto"
          padding={0}
          overflow="hidden"
          borderWidth="1px"
          borderStyle="solid"
          borderColor={{ base: "border", _dark: "border.emphasized/50" }}
          borderRadius={{ base: "18px", md: "20px" }}
          boxShadow="0 2px 8px {colors.docs.shadow}, 0 28px 80px -16px {colors.docs.shadowStrong}"
        >
          <Box className="docs-command-bar">
            <CommandBarInput
              inputRef={noInput}
              query=""
              onChange={ignore}
              onKeyDown={ignore}
              isSearching
              placeholder="Search the LangWatch docs"
            />
            <Box className="docs-command-results" borderTopWidth="1px" borderColor="border">
              <Box data-search-part="failed" hidden padding="4">
                <Text>Search could not load.</Text>
                <Button size="sm" data-search-part="retry">
                  Retry
                </Button>
              </Box>
              <p role="alert" className="docs-search-failed" data-search-part="broken" hidden>
                Search stopped working on this page. Reload the page to search again, or browse the
                sections in the sidebar.
              </p>
              <Text data-search-part="empty" hidden padding="4" />
              <Box id="docs-search-results" as="ul" aria-label="Documentation and actions" />
            </Box>
            <Text
              as="output"
              aria-live="polite"
              data-search-part="status"
              paddingX="5"
              paddingY="2"
              fontSize="12px"
              color="fg.muted"
            >
              Search by topic, integration or endpoint
            </Text>
            <CommandBarFooter isMac={false} />
            <Button className="docs-command-close" size="xs" variant="ghost" data-search-part="close">
              Close
            </Button>
          </Box>
        </chakra.dialog>
      </template>
      <template id="docs-search-group">
        <CommandBarGroup label="">{null}</CommandBarGroup>
      </template>
      <template id="docs-search-page">
        <li>
          <chakra.a {...ROW_TARGET} href="#">
            <CommandBarItem
              icon={FileText}
              iconColor="fg.muted"
              label="-"
              description="-"
              meta="-"
              index={0}
              isSelected={false}
              onSelect={ignore}
              onMouseEnter={ignore}
            />
          </chakra.a>
        </li>
      </template>
      <template id="docs-search-action">
        <li>
          <chakra.button {...ROW_TARGET} type="button">
            <CommandBarItem
              icon={Zap}
              iconColor="accent.fg"
              label="-"
              description="-"
              index={0}
              isSelected={false}
              onSelect={ignore}
              onMouseEnter={ignore}
            />
          </chakra.button>
        </li>
      </template>
      <template id="docs-search-icon-heading">
        <Hash size={18} />
      </template>
      <template id="docs-search-icon-link">
        <ArrowUpRight size={18} />
      </template>
    </>
  );
}
