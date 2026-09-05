import { Box, chakra, HStack, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { findSkill } from "../../../../model/shared/langy/langy-skills";
import type { LangyContextChip, LangySkillChip } from "../../../../index";

/**
 * A skill chip: "do THIS", optionally "…on THAT".
 */
export function LangySkillChipView({
  chip,
  contextChips,
  onRemove,
  onRetarget,
}: {
  chip: LangySkillChip;
  /** The resource chips on this turn — the only legal targets. */
  contextChips: LangyContextChip[];
  onRemove: () => void;
  onRetarget: (targetChipId: string | null) => void;
}) {
  const skill = findSkill(chip.id);
  const [expanded, setExpanded] = useState(false);
  // The binding stores an ID, so a target that has since been removed from the
  // turn resolves to nothing rather than to a stale label.
  const target = contextChips.find((c) => c.id === chip.targetChipId) ?? null;

  const tooltipContent = (
    <Box maxWidth="260px">
      <Text textStyle="xs" fontWeight="600">
        Langy will use: {chip.label}
      </Text>
      <Text textStyle="2xs" color="fg.muted" marginTop={0.5}>
        {skill?.summary ?? "This capability."}
      </Text>
      <Text textStyle="2xs" color="fg.muted" marginTop={1}>
        {target ? `Aimed at: ${target.label}` : "Not aimed at anything in particular."}
      </Text>
    </Box>
  );

  // Skills are the loud chips on purpose: they change what Langy DOES, where a
  // context chip only changes what it looks at. The brand tint is the
  // difference between a noun and an imperative.
  const pillProps = {
    gap: 1,
    paddingLeft: 2,
    paddingRight: 1,
    paddingY: 0.5,
    borderRadius: "full" as const,
    borderWidth: "1px",
    borderStyle: "solid" as const,
    borderColor: "orange.emphasized",
    background: "orange.subtle",
    maxWidth: "100%",
  };

  const verb = (
    <>
      <Box color="orange.fg" flexShrink={0} display="grid">
        <Sparkles size={11} />
      </Box>
      <Text textStyle="2xs" color="fg" fontWeight="500" truncate>
        {chip.label}
      </Text>
    </>
  );

  if (!expanded) {
    // Collapsed: the whole pill is one button that expands. No nested
    // interactive children, so a plain <button> is valid here.
    return (
      <Tooltip openDelay={250} positioning={{ placement: "top" }} content={tooltipContent}>
        <chakra.button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label={
            target
              ? `${chip.label} skill, aimed at ${target.label}. Expand options`
              : `${chip.label} skill. Expand options`
          }
          display="inline-flex"
          alignItems="center"
          cursor="pointer"
          _hover={{ background: "orange.muted" }}
          {...pillProps}
        >
          {verb}
          {target ? (
            // A quiet hint that this skill is aimed at something — the detail
            // lives one expand away.
            <Box
              flexShrink={0}
              width="5px"
              height="5px"
              borderRadius="full"
              background="orange.fg"
            />
          ) : null}
          <Box color="fg.muted" flexShrink={0} display="grid">
            <ChevronDown size={11} />
          </Box>
        </chakra.button>
      </Tooltip>
    );
  }

  return (
    <Tooltip openDelay={250} positioning={{ placement: "top" }} content={tooltipContent}>
      <HStack {...pillProps}>
        {verb}

        {/* The target slot. Shown while expanded — an empty slot invites the
            association; a hidden one hides that it is possible at all. */}
        <Menu.Root positioning={{ placement: "top-start" }}>
          <Menu.Trigger asChild>
            <chakra.button
              type="button"
              aria-label={
                target
                  ? `Change what ${chip.label} is aimed at (currently ${target.label})`
                  : `Aim ${chip.label} at something`
              }
              display="inline-flex"
              alignItems="center"
              gap={0.5}
              maxWidth="140px"
              paddingLeft={1.5}
              paddingRight={1}
              paddingY="1px"
              borderRadius="full"
              borderWidth="1px"
              borderStyle={target ? "solid" : "dashed"}
              borderColor="orange.emphasized"
              background="transparent"
              color={target ? "fg" : "fg.muted"}
              cursor="pointer"
              flexShrink={1}
              minWidth={0}
              _hover={{ color: "fg", background: "orange.muted" }}
            >
              <Text textStyle="2xs" truncate>
                {target ? `on ${target.label}` : "on…"}
              </Text>
              <ChevronDown size={9} />
            </chakra.button>
          </Menu.Trigger>
          <Menu.Content minWidth="200px">
            <Menu.Item value="__none" onClick={() => onRetarget(null)}>
              <Text textStyle="sm" color="fg.muted">
                Anything
              </Text>
            </Menu.Item>
            {contextChips.map((candidate) => (
              <Menu.Item
                key={candidate.id}
                value={candidate.id}
                onClick={() => onRetarget(candidate.id)}
              >
                <Text textStyle="sm" truncate>
                  {candidate.label}
                </Text>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>

        <chakra.button
          type="button"
          aria-label={`Remove ${chip.label} skill`}
          onClick={onRemove}
          display="grid"
          placeItems="center"
          borderRadius="full"
          width="16px"
          height="16px"
          color="fg.muted"
          flexShrink={0}
          _hover={{ color: "fg", background: "bg.muted" }}
        >
          <X size={11} />
        </chakra.button>

        <chakra.button
          type="button"
          aria-label={`Collapse ${chip.label} options`}
          aria-expanded
          onClick={() => setExpanded(false)}
          display="grid"
          placeItems="center"
          borderRadius="full"
          width="16px"
          height="16px"
          color="fg.muted"
          flexShrink={0}
          _hover={{ color: "fg", background: "bg.muted" }}
        >
          <ChevronUp size={11} />
        </chakra.button>
      </HStack>
    </Tooltip>
  );
}
