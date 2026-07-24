/**
 * Shared dropzone visuals for the dataset upload flows (single-file
 * `UploadCSVDrawer` and `BulkUploadDrawer`) so both look identical: the
 * dotted-grid dashed surface, the cloud illustration that grows on hover/drag,
 * and the rainbow "loading" text sheen used while a file prepares.
 */
import { Box, Text, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { CloudUpload } from "lucide-react";

// Dotted-grid surface for the empty dropzone. Raw CSS (not a Chakra token) so
// it composes over the theme-aware background color; `border` follows the
// active color mode.
export const DROPZONE_DOTTED_STYLE: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(var(--chakra-colors-border) 1px, transparent 1px)",
  backgroundSize: "16px 16px",
};

/** Shared Chakra props for the dashed dropzone surface; highlights when active
 *  (dragging a file over it) and on hover, and softly grows the cloud icon. */
export const dropzoneSurfaceProps = (isActive: boolean) => ({
  borderRadius: "xl",
  borderWidth: "2px",
  borderStyle: "dashed" as const,
  borderColor: isActive ? "blue.400" : "border",
  bg: isActive ? "blue.500/10" : "transparent",
  padding: 10,
  textAlign: "center" as const,
  cursor: "pointer",
  width: "full",
  transition: "border-color 0.15s ease, background-color 0.15s ease",
  // Grow the icon while dragging a file over the zone; the icon's own
  // transition animates the grow/shrink smoothly.
  "& .lw-dropzone-icon": isActive ? { transform: "scale(1.12)" } : {},
  _hover: {
    borderColor: "blue.300",
    bg: "blue.500/5",
    "& .lw-dropzone-icon": { transform: "scale(1.12)" },
  },
});

// PostHog's rainbow-scroll text sheen (same recipe as ShikiCommandBox): a
// gradient clipped to the text whose background-position scrolls to animate.
// Applied to a name/status while it uploads — one continuous "loading" tell.
const lwRainbowScroll = keyframes`
  0% { background-position-x: 0%; }
  100% { background-position-x: 200%; }
`;

const LW_RAINBOW_GRADIENT =
  "linear-gradient(90deg, #0143cb 0%, #2b6ff4 24%, #d23401 47%, #ff651f 66%, #fba000 83%, #0143cb 100%)";

export const RAINBOW_TEXT_CSS = {
  color: "transparent",
  backgroundImage: LW_RAINBOW_GRADIENT,
  backgroundClip: "text",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundSize: "200% 100%",
  animation: `${lwRainbowScroll} 3s linear infinite`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

/**
 * Empty-state contents of the dropzone: an upload illustration, the primary
 * prompt (with "click to browse" reading as a link), and the supported types.
 * `multiple` switches the copy to the plural (bulk) form.
 */
export function DropzonePrompt({ multiple = false }: { multiple?: boolean }) {
  return (
    <VStack gap={2}>
      <Box
        className="lw-dropzone-icon"
        color="blue.400"
        transition="transform 0.2s ease"
        transformOrigin="center"
      >
        <CloudUpload size={36} strokeWidth={1.5} />
      </Box>
      <Text fontSize="md" color="fg">
        {multiple ? "Drag and drop files, or " : "Drag and drop file, or "}
        <Text as="span" color="blue.500" fontWeight="medium">
          click to browse
        </Text>
      </Text>
      <Text fontSize="xs" color="fg.muted">
        Supported files: CSV, JSON, or JSONL
        {multiple ? " — one dataset per file" : ""}
      </Text>
    </VStack>
  );
}
