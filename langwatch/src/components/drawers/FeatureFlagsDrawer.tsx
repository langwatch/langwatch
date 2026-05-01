import {
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { LuRotateCcw } from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";
import { useDrawer } from "~/hooks/useDrawer";
import {
  clearAllFeatureFlagOverrides,
  setFeatureFlagOverride,
  useFeatureFlagOverrides,
} from "~/hooks/useFeatureFlagOverrides";
import {
  FRONTEND_FEATURE_FLAGS,
  type FrontendFeatureFlag,
} from "~/server/featureFlag/frontendFeatureFlags";
import { Drawer } from "../ui/drawer";

type OverrideState = "on" | "off" | "default";

function stateOf(value: boolean | undefined): OverrideState {
  if (value === true) return "on";
  if (value === false) return "off";
  return "default";
}

function cycleNext(current: boolean | undefined): boolean | undefined {
  if (current === undefined) return true;
  if (current === true) return false;
  return undefined;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
  );
}

export function FeatureFlagsDrawer() {
  const { closeDrawer } = useDrawer();
  const overrides = useFeatureFlagOverrides();
  const overrideCount = Object.keys(overrides).length;
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Mirror the latest selection + overrides into refs so the global keydown
  // listener can read fresh state without re-binding on every keystroke.
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const idx = selectedIndexRef.current;
      const flag = FRONTEND_FEATURE_FLAGS[idx];

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) =>
            Math.min(i + 1, FRONTEND_FEATURE_FLAGS.length - 1),
          );
          return;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        case " ":
        case "Enter":
          if (!flag) return;
          e.preventDefault();
          setFeatureFlagOverride(flag, cycleNext(overridesRef.current[flag]));
          return;
        case "1":
          if (!flag) return;
          e.preventDefault();
          setFeatureFlagOverride(flag, true);
          return;
        case "0":
          if (!flag) return;
          e.preventDefault();
          setFeatureFlagOverride(flag, false);
          return;
        case "c":
        case "Backspace":
          if (!flag) return;
          e.preventDefault();
          setFeatureFlagOverride(flag, undefined);
          return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="md"
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Content>
        <Drawer.Header>
          <HStack width="full">
            <Heading size="md">Feature Flags (Dev)</Heading>
            <Spacer />
            <Button
              size="xs"
              variant="ghost"
              onClick={clearAllFeatureFlagOverrides}
              disabled={overrideCount === 0}
            >
              <LuRotateCcw size={12} />
              Clear all
            </Button>
          </HStack>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <Text textStyle="xs" color="fg.muted">
              Overrides are stored in this browser only and force the flag value
              for every consumer in the current tab. Clear an override to fall
              back to the server-resolved value.
            </Text>
            <VStack align="stretch" gap={3}>
              {FRONTEND_FEATURE_FLAGS.map((flag, idx) => (
                <FlagRow
                  key={flag}
                  flag={flag}
                  state={stateOf(overrides[flag])}
                  selected={idx === selectedIndex}
                  onSelect={() => setSelectedIndex(idx)}
                />
              ))}
            </VStack>
            <ShortcutHints />
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

interface FlagRowProps {
  flag: FrontendFeatureFlag;
  state: OverrideState;
  selected: boolean;
  onSelect: () => void;
}

function FlagRow({ flag, state, selected, onSelect }: FlagRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  return (
    <Box
      ref={ref}
      borderWidth="1px"
      borderColor={selected ? "blue.solid" : "border"}
      borderRadius="md"
      paddingX={3}
      paddingY={2.5}
      onMouseEnter={onSelect}
      bg={selected ? "blue.subtle" : undefined}
      transition="background 0.12s ease, border-color 0.12s ease"
    >
      <VStack align="stretch" gap={2}>
        <HStack gap={2}>
          <Text fontFamily="mono" textStyle="xs" truncate>
            {flag}
          </Text>
          <Spacer />
          <Text
            textStyle="2xs"
            color={state === "default" ? "fg.muted" : "fg"}
            fontWeight={state === "default" ? "normal" : "600"}
            textTransform="uppercase"
            letterSpacing="0.06em"
          >
            {state === "default" ? "Server" : `Forced ${state}`}
          </Text>
        </HStack>
        <HStack gap={1}>
          <SegmentButton
            label="On"
            active={state === "on"}
            onClick={() => setFeatureFlagOverride(flag, true)}
          />
          <SegmentButton
            label="Off"
            active={state === "off"}
            onClick={() => setFeatureFlagOverride(flag, false)}
          />
          <SegmentButton
            label="Default"
            active={state === "default"}
            onClick={() => setFeatureFlagOverride(flag, undefined)}
          />
        </HStack>
      </VStack>
    </Box>
  );
}

interface SegmentButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function SegmentButton({ label, active, onClick }: SegmentButtonProps) {
  return (
    <Button
      size="xs"
      flex={1}
      variant={active ? "solid" : "outline"}
      colorPalette={active ? "orange" : "gray"}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function ShortcutHints() {
  return (
    <HStack
      gap={3}
      flexWrap="wrap"
      paddingTop={2}
      borderTopWidth="1px"
      borderTopColor="border"
      color="fg.muted"
      textStyle="2xs"
    >
      <HStack gap={1}>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        <Text>navigate</Text>
      </HStack>
      <HStack gap={1}>
        <Kbd>Space</Kbd>
        <Text>cycle</Text>
      </HStack>
      <HStack gap={1}>
        <Kbd>1</Kbd>
        <Text>on</Text>
      </HStack>
      <HStack gap={1}>
        <Kbd>0</Kbd>
        <Text>off</Text>
      </HStack>
      <HStack gap={1}>
        <Kbd>c</Kbd>
        <Text>clear</Text>
      </HStack>
      <HStack gap={1}>
        <Kbd>Esc</Kbd>
        <Text>close</Text>
      </HStack>
    </HStack>
  );
}
