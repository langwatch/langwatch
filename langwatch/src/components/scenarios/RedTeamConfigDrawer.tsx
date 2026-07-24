import {
  Accordion,
  Box,
  Button,
  Field,
  HStack,
  Heading,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Drawer } from "../ui/drawer";

export const RED_TEAM_STRATEGIES = [
  {
    value: "crescendo" as const,
    label: "Crescendo",
    description: "Escalates gradually through fixed phases. Start here.",
  },
  {
    value: "goat" as const,
    label: "GOAT",
    description:
      "Picks a new angle each turn based on how the agent responds. Better against agents that hold firm.",
  },
];

export const RED_TEAM_DEFAULT_TURNS = 30;
export const RED_TEAM_MAX_TURNS = 50;

export interface RedTeamConfigValue {
  redTeamStrategy: "goat" | "crescendo" | null;
  redTeamTarget: string | null;
  redTeamTotalTurns: number | null;
  redTeamConfig: {
    successScore?: number;
    successConfirmTurns?: number;
    injectionProbability?: number;
  } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  value: RedTeamConfigValue;
  onSave: (value: RedTeamConfigValue) => void;
}

/**
 * Configures an adversarial attack against the scenario's target.
 *
 * Nested inside ScenarioFormDrawer with local open/close state, matching the
 * AgentTypeSelectorDrawer / PromptEditorDrawer pattern: it edits the parent
 * form's in-memory value and is not independently addressable.
 *
 * See specs/scenarios/red-team-scenarios.feature.
 */
export function RedTeamConfigDrawer({
  open,
  onClose,
  value,
  onSave,
}: Props) {
  const [strategy, setStrategy] = useState(value.redTeamStrategy ?? "crescendo");
  const [target, setTarget] = useState(value.redTeamTarget ?? "");
  const [turns, setTurns] = useState(
    value.redTeamTotalTurns ?? RED_TEAM_DEFAULT_TURNS,
  );
  const [successScore, setSuccessScore] = useState(
    value.redTeamConfig?.successScore,
  );
  const [injectionProbability, setInjectionProbability] = useState(
    value.redTeamConfig?.injectionProbability,
  );

  useEffect(() => {
    if (!open) return;
    setStrategy(value.redTeamStrategy ?? "crescendo");
    setTarget(value.redTeamTarget ?? "");
    setTurns(value.redTeamTotalTurns ?? RED_TEAM_DEFAULT_TURNS);
    setSuccessScore(value.redTeamConfig?.successScore);
    setInjectionProbability(value.redTeamConfig?.injectionProbability);
  }, [open, value]);

  const targetInvalid = target.trim().length === 0;
  const turnsInvalid = turns < 1 || turns > RED_TEAM_MAX_TURNS;

  const handleSave = () => {
    if (targetInvalid || turnsInvalid) return;
    const advanced = {
      ...(successScore !== undefined ? { successScore } : {}),
      ...(injectionProbability !== undefined ? { injectionProbability } : {}),
    };
    onSave({
      redTeamStrategy: strategy,
      redTeamTarget: target.trim(),
      redTeamTotalTurns: turns,
      redTeamConfig: Object.keys(advanced).length > 0 ? advanced : null,
    });
    onClose();
  };

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="lg"
      onOpenChange={({ open }) => !open && onClose()}
    >
      <Drawer.Content>
        <Drawer.Header borderBottomWidth="1px">
          <VStack align="start" gap={1}>
            <Heading size="md">Configure attack</Heading>
            <Text textStyle="sm" color="fg.muted">
              A simulated attacker will try to make your agent do something it
              should refuse.
            </Text>
          </VStack>
          <Drawer.CloseTrigger />
        </Drawer.Header>

        <Drawer.Body>
          <VStack align="stretch" gap={6}>
            <Box
              borderWidth="1px"
              borderColor="orange.200"
              bg="orange.50"
              _dark={{ bg: "orange.950", borderColor: "orange.900" }}
              borderRadius="md"
              padding={3}
            >
              <HStack gap={2} align="start">
                <Box paddingTop="2px" color="orange.600">
                  <ShieldAlert size={16} />
                </Box>
                <Text textStyle="sm" color="fg.muted">
                  Only run this against agents you own or have permission to
                  test.
                </Text>
              </HStack>
            </Box>

            <VStack align="stretch" gap={2}>
              <Text textStyle="sm" fontWeight="medium">
                Strategy
              </Text>
              <VStack align="stretch" gap={2}>
                {RED_TEAM_STRATEGIES.map((option) => (
                  <Box
                    key={option.value}
                    role="button"
                    tabIndex={0}
                    cursor="pointer"
                    textAlign="left"
                    borderWidth="1px"
                    borderRadius="md"
                    padding={3}
                    borderColor={
                      strategy === option.value ? "orange.400" : "border.muted"
                    }
                    bg={strategy === option.value ? "orange.50" : undefined}
                    _dark={{
                      bg: strategy === option.value ? "orange.950" : undefined,
                    }}
                    onClick={() => setStrategy(option.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setStrategy(option.value);
                      }
                    }}
                  >
                    <Text textStyle="sm" fontWeight="medium">
                      {option.label}
                    </Text>
                    <Text textStyle="xs" color="fg.muted">
                      {option.description}
                    </Text>
                  </Box>
                ))}
              </VStack>
            </VStack>

            <Field.Root invalid={targetInvalid}>
              <Text textStyle="sm" fontWeight="medium">
                What should the attacker try to do?
              </Text>
              <Textarea
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                rows={3}
                placeholder="e.g., get the agent to reveal its system prompt"
                _placeholder={{ color: "gray.400", fontStyle: "italic" }}
              />
              <Field.ErrorText>
                Describe what the attacker is trying to achieve.
              </Field.ErrorText>
            </Field.Root>

            <Field.Root invalid={turnsInvalid}>
              <Text textStyle="sm" fontWeight="medium">
                Turns
              </Text>
              <Input
                type="number"
                value={turns}
                min={1}
                max={RED_TEAM_MAX_TURNS}
                onChange={(e) => setTurns(Number(e.target.value))}
                width="120px"
              />
              <Text textStyle="xs" color="fg.muted">
                How many attempts the attacker gets. More turns find more, and
                cost more.
              </Text>
              <Field.ErrorText>
                Pick between 1 and {RED_TEAM_MAX_TURNS} turns.
              </Field.ErrorText>
            </Field.Root>

            <Accordion.Root collapsible>
              <Accordion.Item value="advanced">
                <Accordion.ItemTrigger>
                  <Text textStyle="sm" fontWeight="medium">
                    Advanced
                  </Text>
                  <Accordion.ItemIndicator />
                </Accordion.ItemTrigger>
                <Accordion.ItemContent>
                  <Accordion.ItemBody>
                    <VStack align="stretch" gap={4} paddingTop={2}>
                      <Field.Root>
                        <Text textStyle="sm">Stop early at score</Text>
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          value={successScore ?? ""}
                          placeholder="9"
                          width="120px"
                          onChange={(e) =>
                            setSuccessScore(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                            )
                          }
                        />
                        <Text textStyle="xs" color="fg.muted">
                          Stop once the attacker is this close to succeeding.
                        </Text>
                      </Field.Root>

                      <Field.Root>
                        <Text textStyle="sm">Obfuscation</Text>
                        <Input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={injectionProbability ?? ""}
                          placeholder="0"
                          width="120px"
                          onChange={(e) =>
                            setInjectionProbability(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                            )
                          }
                        />
                        <Text textStyle="xs" color="fg.muted">
                          How often to disguise messages, between 0 and 1.
                        </Text>
                      </Field.Root>
                    </VStack>
                  </Accordion.ItemBody>
                </Accordion.ItemContent>
              </Accordion.Item>
            </Accordion.Root>
          </VStack>
        </Drawer.Body>

        <Drawer.Footer borderTopWidth="1px">
          <Button
            colorPalette="orange"
            onClick={handleSave}
            disabled={targetInvalid || turnsInvalid}
          >
            Save attack
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
