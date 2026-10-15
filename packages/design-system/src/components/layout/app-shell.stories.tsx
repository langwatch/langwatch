import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BarChart3, FlaskConical, Folder, MessagesSquare, Settings } from "lucide-react";
import { useRef, useState } from "react";

import { LogoIcon } from "../brand/logo-icon.tsx";
import {
  AppTopBar,
  CommandBarFooter,
  CommandBarGroup,
  CommandBarHint,
  CommandBarInput,
  CommandBarItem,
  CommandBarSurface,
  IconRail,
  IconRailTile,
  SidebarSection,
} from "./app-shell.tsx";

const PRODUCTS = [
  { id: "observe", label: "Observe", icon: BarChart3 },
  { id: "evaluate", label: "Evaluate", icon: FlaskConical },
  { id: "simulate", label: "Simulate", icon: MessagesSquare },
];

function Rail({ active }: { active: string }) {
  return (
    <IconRail
      home={<LogoIcon height={30} forceColorMode="light" />}
      footer={
        <IconRailTile
          icon={Settings}
          label="Settings"
          title="Settings"
          isActive={active === "settings"}
          onOpen={() => undefined}
        />
      }
    >
      {PRODUCTS.map((product) => (
        <IconRailTile
          key={product.id}
          icon={product.icon}
          label={product.label}
          title={product.label}
          isActive={product.id === active}
          onOpen={() => undefined}
        />
      ))}
    </IconRail>
  );
}

function Section({ label, defaultOpen }: { label: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <SidebarSection
      label={label}
      heading={
        <Text textStyle="xs" fontWeight="medium" textTransform="uppercase">
          {label}
        </Text>
      }
      isExpanded={open}
      onToggle={() => setOpen(!open)}
      showExpanded
    >
      {["Traces", "Analytics", "Annotations"].map((item) => (
        <Text key={item} paddingX={2} textStyle="sm">
          {item}
        </Text>
      ))}
    </SidebarSection>
  );
}

function Palette() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  return (
    <>
      <CommandBarInput
        inputRef={inputRef}
        query={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={() => undefined}
        isSearching={query.length >= 2}
      />
      <Box paddingBottom={2}>
        <CommandBarGroup label="Go to">
          {PRODUCTS.map((product, index) => (
            <CommandBarItem
              key={product.id}
              icon={product.icon}
              iconColor="orange.500"
              label={product.label}
              description="Product"
              index={index}
              isSelected={index === selected}
              onSelect={() => undefined}
              onMouseEnter={() => setSelected(index)}
            />
          ))}
        </CommandBarGroup>
        <CommandBarGroup label="Recent">
          <CommandBarItem
            icon={Folder}
            iconColor="gray.400"
            label="Checkout assistant"
            description="Acme / Support"
            meta="2h"
            index={PRODUCTS.length}
            isSelected={selected === PRODUCTS.length}
            onSelect={() => undefined}
            onMouseEnter={() => setSelected(PRODUCTS.length)}
          />
        </CommandBarGroup>
      </Box>
      <CommandBarHint hint="Type a trace id to open it directly." />
      <CommandBarFooter isMac />
    </>
  );
}

const meta = {
  title: "Chrome and app shell/App shell",
  parameters: {
    layout: "fullscreen",
    usage: {
      use: "The frame around every page: the product rail, the top bar, sidebar sections and the command bar. Navigation renders these with its products, routes, registry and keyboard.",
      avoid:
        "Fetching or routing inside these views, or a second copy of any of them in a module: pass the data and the callbacks in.",
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shell: Story = {
  render: () => (
    <HStack align="stretch" gap={0} minHeight="32rem">
      <Rail active="observe" />
      <VStack flex={1} gap={0} align="stretch">
        <AppTopBar
          height={56}
          controls={<Text fontWeight="medium">Acme Robotics</Text>}
          trailing={<Text color="fg.muted">Account</Text>}
        />
        <HStack align="start" padding={4} gap={6}>
          <VStack width="14rem" align="stretch">
            <Section label="Observe" defaultOpen />
            <Section label="Library" defaultOpen={false} />
          </VStack>
          <Text color="fg.muted">Page content.</Text>
        </HStack>
      </VStack>
    </HStack>
  ),
};

/** An operator viewing as someone else: the bar glows so it is never mistaken for their own. */
export const TopBarImpersonating: Story = {
  render: () => (
    <AppTopBar
      height={56}
      glow="impersonating"
      controls={<Text fontWeight="medium">Acme Robotics</Text>}
      trailing={<Text color="fg.muted">Viewing as Dana</Text>}
    />
  ),
};

export const TopBarDevelopment: Story = {
  render: () => (
    <AppTopBar
      height={56}
      glow="development"
      controls={
        <Text fontWeight="medium">
          A very long organization name that has to truncate somewhere
        </Text>
      }
      trailing={<Text color="fg.muted">Account</Text>}
    />
  ),
};

export const CommandBar: Story = {
  render: () => (
    <CommandBarSurface open onClose={() => undefined} maxWidth="680px" topMargin="12vh">
      <Palette />
    </CommandBarSurface>
  ),
};

export const CommandBarHandingOff: Story = {
  render: () => (
    <CommandBarSurface open onClose={() => undefined} handingOff maxWidth="680px" topMargin="12vh">
      <Palette />
    </CommandBarSurface>
  ),
};
