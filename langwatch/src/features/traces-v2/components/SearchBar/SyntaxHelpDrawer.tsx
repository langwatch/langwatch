import {
  Badge,
  Box,
  Clipboard,
  Code,
  Heading,
  HStack,
  IconButton,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  ArrowUpRight,
  Check,
  Copy,
  HelpCircle,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import type React from "react";
import { Drawer } from "~/components/ui/drawer";
import { Tooltip } from "~/components/ui/tooltip";
import {
  FIELD_VALUES,
  SEARCH_FIELDS,
  type SearchFieldMeta,
} from "~/server/app-layer/traces/query-language/queryParser";
import { useFilterStore } from "../../stores/filterStore";
import { useUIStore } from "../../stores/uiStore";
import { QueryPreview } from "./QueryPreview";

interface Example {
  label: string;
  query: string;
}

type WarmAccent = "orange" | "red" | "yellow" | "pink";

const EXAMPLE_GROUPS: ReadonlyArray<{
  title: string;
  icon: React.ElementType;
  accent: WarmAccent;
  examples: ReadonlyArray<Example>;
}> = [
  {
    title: "Common",
    icon: Zap,
    accent: "orange",
    examples: [
      { label: "Failing traces", query: "status:error" },
      { label: "GPT-4 family", query: "model:gpt-4*" },
      { label: "Slow + expensive", query: "duration:>5000 AND cost:>0.10" },
    ],
  },
  {
    title: "Combine",
    icon: Wand2,
    accent: "red",
    examples: [
      {
        label: "Failing or warning",
        query: "(status:error OR status:warning)",
      },
      { label: "Failing OpenAI", query: "status:error AND model:gpt-*" },
      { label: "Not OK", query: "NOT status:ok" },
    ],
  },
  {
    title: "Numbers",
    icon: Sparkles,
    accent: "yellow",
    examples: [
      { label: "Cost between", query: "cost:[0.01 TO 1.00]" },
      { label: "Long traces", query: "duration:>10000" },
      { label: "Many spans", query: "spans:>=20" },
    ],
  },
  {
    title: "Look up",
    icon: HelpCircle,
    accent: "pink",
    examples: [
      { label: "By user", query: 'user:"alice@example.com"' },
      { label: "Mention of refund", query: '"refund policy"' },
      { label: "Has eval", query: "has:eval" },
    ],
  },
];

const OPERATOR_ROWS: ReadonlyArray<{
  op: string;
  meaning: string;
  example: string;
}> = [
  {
    op: "AND",
    meaning: "Both must match",
    example: "status:error AND model:gpt-4o",
  },
  {
    op: "OR",
    meaning: "Either may match",
    example: "origin:simulation OR origin:evaluation",
  },
  { op: "NOT  /  -", meaning: "Negate next clause", example: "NOT status:ok" },
  {
    op: "( … )",
    meaning: "Group clauses",
    example: "(status:error OR status:warning)",
  },
];

const VALUE_ROWS: ReadonlyArray<{
  form: string;
  example: string;
  notes: string;
}> = [
  { form: "Exact", example: "model:gpt-4o", notes: "Case-insensitive" },
  { form: "Wildcard", example: "model:gpt-*", notes: "* matches anything" },
  { form: "Comparison", example: "cost:>0.05", notes: ">, >=, <, <=" },
  { form: "Range", example: "cost:[0.01 TO 1.00]", notes: "Inclusive" },
  {
    form: "Quoted",
    example: 'user:"alice@x.com"',
    notes: "For values with spaces",
  },
  {
    form: "Free text",
    example: '"refund policy"',
    notes: "Searches input/output",
  },
];

/**
 * Mounts the syntax-help drawer. The trigger to open it lives elsewhere
 * (autocomplete footer, parse-error popover) — this component just renders
 * the drawer itself, driven by `uiStore.syntaxHelpOpen`.
 */
export const SyntaxHelpDrawerHost: React.FC = () => {
  const open = useUIStore((s) => s.syntaxHelpOpen);
  const setOpen = useUIStore((s) => s.setSyntaxHelpOpen);
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      size="md"
      modal
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Query syntax</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body padding={0} bg="bg.muted">
          <SyntaxHelpBody onClose={() => setOpen(false)} />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
};

interface SyntaxHelpBodyProps {
  onClose: () => void;
}

const SyntaxHelpBody: React.FC<SyntaxHelpBodyProps> = ({ onClose }) => {
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const apply = (query: string) => {
    applyQueryText(query);
    onClose();
  };

  return (
    <VStack align="stretch" gap={6} paddingX={5} paddingY={6}>
      <Section
        title="Cookbook"
        caption="Click to apply, or copy with the icon."
      >
        <ExampleCookbook onApply={apply} />
      </Section>

      <Section title="Operators">
        <SyntaxTable
          columns={["Operator", "Meaning", "Example"]}
          rows={OPERATOR_ROWS.map((r) => ({
            key: r.op,
            cells: [
              <Code key="op" colorPalette="orange" variant="surface">
                {r.op}
              </Code>,
              <Text key="meaning" textStyle="sm" color="fg">
                {r.meaning}
              </Text>,
              <CopyableQuery key="ex" query={r.example} onApply={apply} />,
            ],
          }))}
        />
      </Section>

      <Section title="Values">
        <SyntaxTable
          columns={["Form", "Example", "Notes"]}
          rows={VALUE_ROWS.map((r) => ({
            key: r.form,
            cells: [
              <Text key="form" textStyle="sm" fontWeight="600" color="fg">
                {r.form}
              </Text>,
              <CopyableQuery key="ex" query={r.example} onApply={apply} />,
              <Text key="notes" textStyle="xs" color="fg.muted">
                {r.notes}
              </Text>,
            ],
          }))}
        />
      </Section>

      <Section
        title="Fields"
        caption={`${Object.keys(SEARCH_FIELDS).length} queryable fields`}
      >
        <FieldsTable onApply={apply} />
      </Section>

      <SyntaxTipStrip />
    </VStack>
  );
};

const SYNTAX_TIPS: ReadonlyArray<{ label: string; example: string }> = [
  { label: "wildcard", example: "model:gpt-*" },
  { label: "exclusion", example: "-status:ok" },
  { label: "range", example: "cost:[0.01 TO 1]" },
  { label: "union", example: "status:(error OR warning)" },
  { label: "free text", example: "refund" },
];

const SyntaxTipStrip: React.FC = () => (
  <Box
    paddingX={4}
    paddingY={3}
    borderRadius="md"
    bg="bg.subtle"
    borderWidth="1px"
    borderColor="border"
  >
    <HStack gap={4} flexWrap="wrap" rowGap={2}>
      {SYNTAX_TIPS.map((tip) => (
        <HStack key={tip.label} gap={1.5}>
          <Text
            textStyle="2xs"
            color="fg.subtle"
            textTransform="uppercase"
            letterSpacing="0.06em"
          >
            {tip.label}:
          </Text>
          <QueryPreview query={tip.example} />
        </HStack>
      ))}
    </HStack>
  </Box>
);

const Section: React.FC<{
  title: string;
  caption?: string;
  children: React.ReactNode;
}> = ({ title, caption, children }) => (
  <VStack
    align="stretch"
    gap={3}
    padding={4}
    bg="bg.panel"
    borderWidth="1px"
    borderColor="border"
    borderRadius="lg"
  >
    <HStack justify="space-between" align="baseline">
      <Heading size="sm" letterSpacing="-0.01em">
        {title}
      </Heading>
      {caption && (
        <Text textStyle="xs" color="fg.muted">
          {caption}
        </Text>
      )}
    </HStack>
    {children}
  </VStack>
);

const ExampleCookbook: React.FC<{ onApply: (query: string) => void }> = ({
  onApply,
}) => (
  <VStack gap={3} align="stretch">
    {EXAMPLE_GROUPS.map((group) => (
      <ExampleCard key={group.title} group={group} onApply={onApply} />
    ))}
  </VStack>
);

const ExampleCard: React.FC<{
  group: (typeof EXAMPLE_GROUPS)[number];
  onApply: (query: string) => void;
}> = ({ group, onApply }) => {
  const Icon = group.icon;
  return (
    <VStack
      align="stretch"
      gap={2}
      padding={3}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg.subtle"
      transition="border-color 120ms ease"
      _hover={{ borderColor: `${group.accent}.muted` }}
    >
      <HStack gap={2} align="center">
        <Box
          boxSize="22px"
          borderRadius="sm"
          bg={`${group.accent}.subtle`}
          color={`${group.accent}.fg`}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Icon size={12} />
        </Box>
        <Text
          textStyle="2xs"
          fontWeight="700"
          color="fg"
          textTransform="uppercase"
          letterSpacing="0.08em"
        >
          {group.title}
        </Text>
      </HStack>
      <VStack align="stretch" gap={1}>
        {group.examples.map((ex) => (
          <ExampleRow
            key={ex.query}
            example={ex}
            accent={group.accent}
            onApply={onApply}
          />
        ))}
      </VStack>
    </VStack>
  );
};

const ExampleRow: React.FC<{
  example: Example;
  accent: WarmAccent;
  onApply: (query: string) => void;
}> = ({ example, accent, onApply }) => (
  <HStack
    gap={2}
    paddingX={2}
    paddingY={1.5}
    borderRadius="sm"
    role="group"
    transition="background 100ms ease"
    _hover={{ bg: `${accent}.subtle` }}
  >
    <Box
      as="button"
      type="button"
      onClick={() => onApply(example.query)}
      flex={1}
      minWidth={0}
      cursor="pointer"
      textAlign="left"
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "1px",
      }}
    >
      <Text textStyle="xs" color="fg.muted" truncate>
        {example.label}
      </Text>
      <QueryPreview query={example.query} />
    </Box>
    <CopyTrigger value={example.query} />
    <Tooltip content="Apply" openDelay={200}>
      <IconButton
        aria-label={`Apply ${example.label}`}
        size="2xs"
        variant="ghost"
        color="fg.subtle"
        opacity={0}
        _groupHover={{ opacity: 1 }}
        onClick={() => onApply(example.query)}
      >
        <ArrowUpRight size={11} />
      </IconButton>
    </Tooltip>
  </HStack>
);

const CopyTrigger: React.FC<{ value: string }> = ({ value }) => (
  <Clipboard.Root value={value}>
    <Tooltip content="Copy" openDelay={200}>
      <Clipboard.Trigger asChild>
        <IconButton
          aria-label="Copy query"
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          opacity={0}
          _groupHover={{ opacity: 1 }}
        >
          <Clipboard.Indicator copied={<Check size={11} />}>
            <Copy size={11} />
          </Clipboard.Indicator>
        </IconButton>
      </Clipboard.Trigger>
    </Tooltip>
  </Clipboard.Root>
);

const SyntaxTable: React.FC<{
  columns: ReadonlyArray<string>;
  rows: ReadonlyArray<{ key: string; cells: ReadonlyArray<React.ReactNode> }>;
}> = ({ columns, rows }) => (
  <Table.Root size="sm" variant="outline">
    <Table.Header>
      <Table.Row bg="bg.subtle">
        {columns.map((col) => (
          <Table.ColumnHeader key={col} textStyle="2xs" letterSpacing="0.08em">
            {col}
          </Table.ColumnHeader>
        ))}
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {rows.map((row) => (
        <Table.Row key={row.key} role="group">
          {row.cells.map((cell, idx) => (
            <Table.Cell key={idx}>{cell}</Table.Cell>
          ))}
        </Table.Row>
      ))}
    </Table.Body>
  </Table.Root>
);

const CopyableQuery: React.FC<{
  query: string;
  onApply: (query: string) => void;
}> = ({ query, onApply }) => (
  <HStack gap={1.5} role="group">
    <Box
      as="button"
      type="button"
      onClick={() => onApply(query)}
      cursor="pointer"
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "1px",
        borderRadius: "sm",
      }}
    >
      <QueryPreview query={query} />
    </Box>
    <CopyTrigger value={query} />
  </HStack>
);

const FieldsTable: React.FC<{ onApply: (query: string) => void }> = ({
  onApply,
}) => {
  const entries = Object.entries(SEARCH_FIELDS);
  return (
    <Table.Root size="sm" variant="outline">
      <Table.Header>
        <Table.Row bg="bg.subtle">
          <Table.ColumnHeader textStyle="2xs" letterSpacing="0.08em">
            Field
          </Table.ColumnHeader>
          <Table.ColumnHeader textStyle="2xs" letterSpacing="0.08em">
            Type
          </Table.ColumnHeader>
          <Table.ColumnHeader textStyle="2xs" letterSpacing="0.08em">
            Example
          </Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {entries.map(([name, meta]) => (
          <FieldRow key={name} name={name} meta={meta} onApply={onApply} />
        ))}
      </Table.Body>
    </Table.Root>
  );
};

const TYPE_PALETTE: Record<SearchFieldMeta["valueType"], string> = {
  categorical: "orange",
  range: "yellow",
  text: "gray",
  existence: "red",
};

const FieldRow: React.FC<{
  name: string;
  meta: SearchFieldMeta;
  onApply: (query: string) => void;
}> = ({ name, meta, onApply }) => {
  const example = exampleFor(name, meta);
  return (
    <Table.Row role="group">
      <Table.Cell>
        <Code size="sm" variant="surface">
          {name}
        </Code>
      </Table.Cell>
      <Table.Cell>
        <Badge
          size="xs"
          colorPalette={TYPE_PALETTE[meta.valueType]}
          variant="subtle"
        >
          {meta.valueType}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <CopyableQuery query={example} onApply={onApply} />
      </Table.Cell>
    </Table.Row>
  );
};

function exampleFor(name: string, meta: SearchFieldMeta): string {
  const enumValues = FIELD_VALUES[name];
  if (enumValues && enumValues[0]) return `${name}:${enumValues[0]}`;
  if (meta.valueType === "range") return `${name}:>10`;
  if (meta.valueType === "existence") return `${name}:error`;
  return `${name}:value`;
}
