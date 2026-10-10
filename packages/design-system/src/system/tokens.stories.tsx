import { Box, Card, Grid, Heading, HStack, Stack, Table, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { colorSystem } from "../color-mode/color-system.ts";
import { DarkMode, LightMode } from "../color-mode/index.tsx";
import { CopyButton } from "../components/display/copy-button.tsx";
import { system } from "./create-system.ts";

/**
 * Every token the system defines, read from the live system rather than listed by
 * hand, so this page cannot drift from `config.ts` or invent a token.
 */
type TokenCategory = Parameters<typeof system.tokens.categoryMap.get>[0];
type Token = { value: unknown; extensions: { conditions?: Record<string, string> } };

function tokensIn({ category }: { category: TokenCategory }): [string, Token][] {
  return [...(system.tokens.categoryMap.get(category) ?? new Map())] as [string, Token][];
}

const colours = tokensIn({ category: "colors" });
const isSemantic = ([name, token]: [string, Token]) =>
  token.extensions.conditions !== undefined && !name.startsWith("colorPalette");
const isScaleStep = ([name]: [string, Token]) => /^[a-z]+(Alpha)?\.\d+$/.test(name);

/** `{colors.gray.600}` to the value it names, so a light or dark chip shows its real colour. */
function resolveColour({ reference, mode }: { reference: string; mode: "light" | "dark" }): string {
  return reference.replace(/\{colors\.([^}/]+)(?:\/(\d+))?\}/g, (whole, name: string, alpha) => {
    const token = colours.find(([candidate]) => candidate === name)?.[1];
    const value = token ? (referenceOf({ token, mode }) ?? token.value) : void 0;
    if (typeof value !== "string") return whole;
    const resolved = resolveColour({ reference: value, mode });
    return alpha ? `color-mix(in srgb, ${resolved} ${alpha}%, transparent)` : resolved;
  });
}

function TokenName({ name }: { name: string }) {
  return (
    <HStack gap={1}>
      <Text fontFamily="mono" fontSize="xs" color="fg">
        {name}
      </Text>
      <CopyButton value={name} label={`Copy ${name}`} />
    </HStack>
  );
}

const referenceOf = ({ token, mode }: { token: Token; mode: "light" | "dark" }) => {
  const conditions = token.extensions.conditions;
  return mode === "light" ? (conditions?._light ?? conditions?.base) : conditions?._dark;
};

const shortReference = (reference?: string) =>
  reference ? reference.replace(/[{}]/g, "").replace(/^colors\./, "") : "—";

/** Light on the left, dark on the right: both modes at a glance, whatever the toolbar says. */
function SplitSwatch({ token }: { token: Token }) {
  const half = (mode: "light" | "dark") => {
    const reference = referenceOf({ token, mode }) ?? referenceOf({ token, mode: "light" });
    return reference ? resolveColour({ reference, mode }) : "transparent";
  };
  return (
    <HStack
      gap={0}
      width={10}
      height={6}
      flexShrink={0}
      borderRadius="sm"
      borderWidth="1px"
      borderColor="border"
      overflow="hidden"
      aria-hidden
    >
      <Box flex={1} height="full" style={{ background: half("light") }} />
      <Box flex={1} height="full" style={{ background: half("dark") }} />
    </HStack>
  );
}

/** One row per colour: swatch, name to copy, then its light and dark values in aligned columns. */
function ColourRow({ name, token }: { name: string; token: Token }) {
  return (
    <Grid
      templateColumns={ROW_COLUMNS}
      gap={3}
      alignItems="center"
      paddingY={1}
      borderBottomWidth="1px"
      borderColor="border.muted"
    >
      <SplitSwatch token={token} />
      <TokenName name={name} />
      {(["light", "dark"] as const).map((mode) => (
        <Text key={mode} fontSize="2xs" fontFamily="mono" color="fg.muted" truncate>
          {shortReference(referenceOf({ token, mode }))}
        </Text>
      ))}
    </Grid>
  );
}

const ROW_COLUMNS = "2.5rem minmax(8rem, 1.2fr) 1fr 1fr";

/** Column headings over each block; the swatch's left half is light, its right half dark. */
function ColourHeadings() {
  return (
    <Grid templateColumns={ROW_COLUMNS} gap={3} paddingY={1} borderBottomWidth="1px">
      {["Light | dark", "Token", "Light", "Dark"].map((heading) => (
        <Text key={heading} fontSize="2xs" color="fg.muted" fontWeight="medium">
          {heading}
        </Text>
      ))}
    </Grid>
  );
}

function ColourRows({ entries }: { entries: [string, Token][] }) {
  return (
    <Grid templateColumns="repeat(auto-fill, minmax(26rem, 1fr))" columnGap={8}>
      <ColourHeadings />
      {entries.map(([name, token]) => (
        <ColourRow key={name} name={name} token={token} />
      ))}
    </Grid>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Stack gap={2}>
      <HStack gap={2} align="baseline">
        <Heading size="sm">{title}</Heading>
        {note ? (
          <Text textStyle="xs" color="fg.muted">
            {note}
          </Text>
        ) : null}
      </HStack>
      {children}
    </Stack>
  );
}

const SEMANTIC_GROUPS: { title: string; note: string; matches: (name: string) => boolean }[] = [
  {
    title: "Foreground",
    note: "Text and icons.",
    matches: (n) => n === "fg" || n.startsWith("fg."),
  },
  {
    title: "Background",
    note: "Four nested levels: bg.page, bg.panel, bg.muted, bg.emphasized.",
    matches: (n) => n === "bg" || n.startsWith("bg."),
  },
  {
    title: "Border",
    note: "Hairlines and outlines; border.strong distinguishes controls from their ground.",
    matches: (n) => n === "border" || n.startsWith("border."),
  },
  {
    title: "Accent",
    note: 'The brand orange; `colorPalette="accent"` follows it.',
    matches: (n) => n.startsWith("accent."),
  },
  { title: "Status", note: "A state, never decoration.", matches: (n) => n.startsWith("status.") },
  {
    title: "Chart series",
    note: "In order, for categorical series.",
    matches: (n) => n.startsWith("chart."),
  },
  {
    title: "Navigation, labels and logo",
    note: "Chrome and the mark.",
    matches: (n) => /^(nav|label|logo)\./.test(n),
  },
  {
    title: "Palette roles",
    note: "`<palette>.<role>`: solid, contrast, fg, muted, subtle, emphasized, focusRing.",
    matches: (n) =>
      /^[a-z]+\.(solid|contrast|fg|muted|subtle|emphasized|focusRing|surface)$/.test(n),
  },
];

function SemanticColours() {
  const semantic = colours.filter(isSemantic);
  const placed = new Set<string>();
  return (
    <Stack gap={6}>
      {SEMANTIC_GROUPS.map(({ title, note, matches }) => {
        const group = semantic.filter(([name]) => !placed.has(name) && matches(name));
        group.forEach(([name]) => placed.add(name));
        return (
          <Section key={title} title={title} note={note}>
            <ColourRows entries={group} />
          </Section>
        );
      })}
      <Section title="Everything else" note="Semantic colours outside the groups above.">
        <ColourRows entries={semantic.filter(([name]) => !placed.has(name))} />
      </Section>
    </Stack>
  );
}

function PaletteScale() {
  const families = new Map<string, [string, Token][]>();
  for (const entry of colours.filter(isScaleStep)) {
    const family = entry[0].split(".")[0] ?? "";
    families.set(family, [...(families.get(family) ?? []), entry]);
  }
  return (
    <Section
      title="Palette scale"
      note="The raw steps semantic tokens are made of. Only this package names a step; feature code names the semantic token."
    >
      <Stack gap={2}>
        {[...families].map(([family, steps]) => (
          <HStack key={family} gap={0} align="stretch">
            <Text width={28} fontFamily="mono" fontSize="xs" flexShrink={0} alignSelf="center">
              {family}
            </Text>
            {steps.map(([name, token]) => (
              <Box
                key={name}
                flex={1}
                height={8}
                title={`${name} ${String(token.value)}`}
                style={{ background: String(token.value) }}
              />
            ))}
          </HStack>
        ))}
      </Stack>
    </Section>
  );
}

/** One row per token: its name to copy, its value, and a sample drawn with it. */
function TokenTable({
  category,
  sample,
}: {
  category: TokenCategory;
  sample: (name: string) => ReactNode;
}) {
  return (
    <Table.Root size="sm" variant="line">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Token</Table.ColumnHeader>
          <Table.ColumnHeader>Value</Table.ColumnHeader>
          <Table.ColumnHeader>Sample</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {tokensIn({ category }).map(([name, token]) => {
          const conditions = token.extensions.conditions;
          const value = conditions
            ? Object.entries(conditions)
                .map(([condition, v]) => `${condition.replace(/^_/, "")}: ${v}`)
                .join(" / ")
            : String(token.value);
          return (
            <Table.Row key={name}>
              <Table.Cell>
                <TokenName name={name} />
              </Table.Cell>
              <Table.Cell>
                <Text
                  fontFamily="mono"
                  fontSize="xs"
                  color="fg.muted"
                  maxWidth="28rem"
                  lineClamp={2}
                >
                  {value}
                </Text>
              </Table.Cell>
              <Table.Cell>{sample(name)}</Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table.Root>
  );
}

const meta = {
  title: "Foundations/Tokens",
  parameters: {
    usage: {
      use: 'Every value a screen needs has a token here: name it (`gap={4}`, `borderRadius="md"`, `boxShadow="md"`, `color="fg.muted"`).',
      avoid:
        "Pixel values, hex, rgb() or a palette step at the call site. A missing value is a new semantic token in `src/system/config.ts`, not a literal.",
    },
    docs: {
      description: {
        component:
          "Every token group in one place, read from the live system. Switch the toolbar between Light and Dark to see each colour in both modes; each swatch also lists its light and dark values.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Colour: Story = { render: () => <SemanticColours /> };

/** Measured from the shipped hex, including sRGB rounding. */
function oklch(hex: string): string {
  const linear = (offset: number) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const r = linear(1),
    g = linear(3),
    b = linear(5);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const blue = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, blue);
  const hue = ((Math.atan2(blue, a) * 180) / Math.PI + 360) % 360;
  return `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`;
}

function InkSwatches() {
  const levels = [
    ["Inset app frame · bg.page", 950],
    ["Content · bg", 900],
    ["Raised · bg.panel", 850],
    ["Controls / hover · bg.muted / bg.emphasized", 800],
    ["Muted edge · border.muted", 750],
    ["Default edge · border", 700],
    ["Muted text · fg.muted", 400],
    ["Text · fg", 50],
  ] as const;
  return (
    <DarkMode>
      <Stack bg="bg.page" color="fg" padding={4} gap={3} borderRadius="lg">
        <Text fontSize="sm">Primer dark · four grounds · hairlines before colour</Text>
        {levels.map(([label, step]) => {
          const hex = colorSystem.zinc[step].value;
          return (
            <HStack key={step} gap={3}>
              <Box
                width={16}
                height={10}
                flexShrink={0}
                borderRadius="md"
                style={{ background: hex }}
                borderWidth="1px"
                borderColor="border"
              />
              <Stack gap={0}>
                <Text fontSize="sm">{label}</Text>
                <Text fontFamily="mono" fontSize="xs" color="fg.muted">
                  {hex} · {oklch(hex)}
                </Text>
              </Stack>
            </HStack>
          );
        })}
      </Stack>
    </DarkMode>
  );
}

export const PrimerDark: Story = { render: () => <InkSwatches /> };

const SURFACE_ROLES = [
  ["App sidebar / top bar", "bg.page", "border"],
  ["Content / section nav / title", "bg", "hairline after scroll"],
  ["Card / ListTable container", "bg.panel", "border"],
  ["Table header / row / empty state", "container ground", "bg.muted / bg.emphasized"],
  ["Well / code block", "bg.muted", "border.muted"],
  ["Input / chip / inline code", "bg.emphasized", "border"],
  ["Drawer / menu / dialog / tooltip", "bg.panel", "border"],
] as const;

function NestedSurfaces() {
  return (
    <Stack bg="bg.page" color="fg" padding={4} gap={4} borderRadius="xl">
      <Text fontSize="sm">App frame · bg.page</Text>
      <Stack
        bg="bg"
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        gap={0}
        overflow="hidden"
      >
        <HStack padding={3} borderBottomWidth="1px" borderColor="border">
          <Text fontSize="sm">Section nav</Text>
          <Text fontSize="sm">Page title · same content ground</Text>
        </HStack>
        <Stack padding={4} gap={4}>
          <Card.Root variant="outline">
            <Card.Body gap={3}>
              <Text>Card · bg.panel / border</Text>
              <Table.Root size="sm">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Region</Table.ColumnHeader>
                    <Table.ColumnHeader>Surface</Table.ColumnHeader>
                    <Table.ColumnHeader>Separation</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {SURFACE_ROLES.map(([region, surface, edge]) => (
                    <Table.Row key={region}>
                      <Table.Cell>{region}</Table.Cell>
                      <Table.Cell>{surface}</Table.Cell>
                      <Table.Cell>{edge}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
              <Stack
                bg="bg.muted"
                borderWidth="1px"
                borderColor="border.muted"
                borderRadius="lg"
                padding={3}
              >
                <Text fontSize="sm">Nested well · bg.muted</Text>
                <Box
                  bg="bg.emphasized"
                  borderWidth="1px"
                  borderColor="border"
                  borderRadius="md"
                  padding={2}
                >
                  <Text fontSize="sm">Small control · bg.emphasized</Text>
                  <Text color="fg.subtle" fontSize="xs">
                    Secondary text remains AA here.
                  </Text>
                </Box>
              </Stack>
            </Card.Body>
          </Card.Root>
          <Stack
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            borderRadius="lg"
            padding={3}
            boxShadow="lg"
          >
            <Text fontSize="sm">Drawer / menu · one opaque overlay</Text>
            <Box borderTopWidth="1px" borderColor="border" paddingTop={2}>
              <Text fontSize="sm">Header, body and footer share this ground.</Text>
              <Box bg="bg.hover" padding={2} borderRadius="sm">
                Hovered menu item · 4% tint
              </Box>
            </Box>
          </Stack>
        </Stack>
      </Stack>
    </Stack>
  );
}

export const SurfaceLadder: Story = {
  render: () => (
    <Stack gap={4}>
      <Text>
        One ground, one card, one overlay. Lift only real containers toward the reader; separate
        with a hairline before colour.
      </Text>
      <InkSwatches />
      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={6}>
        <Stack gap={2}>
          <Heading size="sm">Light</Heading>
          <LightMode>
            <NestedSurfaces />
          </LightMode>
        </Stack>
        <Stack gap={2}>
          <Heading size="sm">Dark</Heading>
          <DarkMode>
            <NestedSurfaces />
          </DarkMode>
        </Stack>
      </Grid>
    </Stack>
  ),
};

export const Palette: Story = { render: () => <PaletteScale /> };

export const Spacing: Story = {
  render: () => (
    <TokenTable
      category="spacing"
      sample={(name) => <Box height={2} bg="accent.solid" borderRadius="xs" width={name} />}
    />
  ),
};

export const Radii: Story = {
  render: () => (
    <TokenTable
      category="radii"
      sample={(name) => <Box boxSize={10} bg="bg.emphasized" borderRadius={name} />}
    />
  ),
};

/** Elevation: the higher the shadow, the further the surface floats. */
export const Shadows: Story = {
  render: () => (
    <TokenTable
      category="shadows"
      sample={(name) => <Box boxSize={10} bg="bg.panel" borderRadius="md" boxShadow={name} />}
    />
  ),
};

/** Stacking order. Overlays opened inside overlays add depth on top: see Overlay depth. */
export const ZIndex: Story = {
  name: "Z index",
  render: () => <TokenTable category="zIndex" sample={() => null} />,
};

export const Durations: Story = {
  render: () => (
    <TokenTable
      category="durations"
      sample={(name) => (
        <Box
          boxSize={6}
          bg="accent.solid"
          borderRadius="sm"
          transitionProperty="transform"
          transitionDuration={name}
          _hover={{ transform: "translateX(2.5rem)" }}
        />
      )}
    />
  ),
};

export const Easings: Story = {
  render: () => (
    <TokenTable
      category="easings"
      sample={(name) => (
        <Box
          boxSize={6}
          bg="accent.solid"
          borderRadius="sm"
          transitionProperty="transform"
          transitionDuration="slow"
          transitionTimingFunction={name}
          _hover={{ transform: "translateX(2.5rem)" }}
        />
      )}
    />
  ),
};

export const Breakpoints: Story = {
  render: () => <TokenTable category="breakpoints" sample={() => null} />,
};

export const FontSizes: Story = {
  render: () => (
    <TokenTable category="fontSizes" sample={(name) => <Text fontSize={name}>Traces</Text>} />
  ),
};

export const FontWeights: Story = {
  render: () => (
    <TokenTable category="fontWeights" sample={(name) => <Text fontWeight={name}>Traces</Text>} />
  ),
};

export const LineHeights: Story = {
  render: () => (
    <TokenTable
      category="lineHeights"
      sample={(name) => (
        <Text lineHeight={name} maxWidth="12rem" fontSize="xs">
          Two lines of copy show the leading between them.
        </Text>
      )}
    />
  ),
};

export const Borders: Story = {
  render: () => (
    <TokenTable
      category="borders"
      sample={(name) => <Box boxSize={8} border={name} borderColor="border.emphasized" />}
    />
  ),
};

/** The ring a focused control draws; every palette has its own `focusRing` colour. */
export const FocusRing: Story = {
  name: "Focus ring",
  render: () => (
    <HStack gap={3} wrap="wrap">
      {["accent", "gray", "red", "blue"].map((palette) => (
        <Box
          key={palette}
          paddingX={3}
          paddingY={1.5}
          borderRadius="md"
          borderWidth="1px"
          borderColor="border"
          outlineWidth="2px"
          outlineStyle="solid"
          outlineOffset="2px"
          outlineColor={`${palette}.focusRing`}
        >
          <Text fontFamily="mono" fontSize="xs">
            {palette}.focusRing
          </Text>
        </Box>
      ))}
    </HStack>
  ),
};
