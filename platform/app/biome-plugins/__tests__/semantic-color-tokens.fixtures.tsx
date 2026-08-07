/**
 * Deliberate violations of `../semantic-color-tokens.grit`. Every construct
 * below is a raw palette shade in a color prop, and every one MUST be flagged.
 *
 * This file exists for the same reason the no-raw-error-toast fixtures do: a
 * GritQL pattern that drifts — a renamed node kind, a regex that stopped
 * anchoring — compiles fine, matches nothing, and reports a clean tree forever.
 * The `Enforce analyzer plugins` step runs the plugin over these known
 * violations and requires a NON-ZERO count before trusting the zero it reports
 * on real code.
 *
 * Not compiled and not linted: it sits outside `src/` and `ee/`, which is the
 * scope of `pnpm lint` and of the CI gate. Keep it there — the moment it lands
 * under `src/` it fails the gate it defends.
 *
 * Adding a pattern to the plugin? Add its violation here and raise the floor
 * in the workflow.
 */

declare const Text: (props: unknown) => JSX.Element;
declare const Box: (props: unknown) => JSX.Element;
declare const on: boolean;

// --- JSX attributes, literal values -----------------------------------------
export const neutralText = <Text color="gray.500" />;
export const neutralSurface = <Box bg="gray.50" />;
export const neutralBorder = <Box borderLeftColor="gray.200" />;
export const hueText = <Text color="red.700" />;
export const hueTextSecondary = <Text color="blue.600" />;
export const hueFill = <Box bg="green.500" />;

// --- JSX attributes, expression values ---------------------------------------
export const ternary = <Box bg={on ? "blue.500" : "transparent"} />;
export const perMode = (
  <Box borderColor={{ base: "gray.200", _dark: "border" }} />
);

// --- object properties -------------------------------------------------------
export const hover = <Box _hover={{ bg: "gray.50" }} />;
export const styleObject = { color: "orange.600", borderColor: "orange.300" };

// --- KNOWN GAP: not flagged, and the rule does not claim to catch it ---------
// A palette keyed by domain rather than by color prop. The rule anchors on the
// prop name, so `passed:` tells it nothing, and keying on the VALUE instead
// would flag every string in the codebase that happens to look like a shade.
// The review habit is the backstop here: a constant that feeds a `color` prop
// gets a token, and the moment it reaches one the rule sees it.
export const statusMap: Record<string, string> = {
  passed: "green.500",
  failed: "red.500",
};

// --- these MUST NOT be flagged ----------------------------------------------
export const okToken = <Text color="fg.subtle" bg="bg.panel" />;
export const okFaint = <Text color="fg.faint" />;
export const okHue = <Text color="red.fgMuted" bg="red.subtle" />;
export const okWhite = <Text color="white" />;
export const okNotAColorProp = { legacyCtaColor: "orange.700" };
// biome-ignore lint/plugin: fixed-gradient hero, must not follow the color mode
export const okSuppressed = <Text color="orange.700" />;
