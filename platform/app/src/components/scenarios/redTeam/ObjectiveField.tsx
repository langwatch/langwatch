import {
  Button,
  Field,
  HStack,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import type {
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
} from "react-hook-form";

import { Menu } from "~/components/ui/menu";
import {
  OBJECTIVE_HELP,
  RED_TEAM_OBJECTIVE_GROUPS,
} from "../redTeamObjectives";
import type { ScenarioFormData } from "../ScenarioForm";
import { LabelWithHelp } from "./LabelWithHelp";

/** The attacker objective, with the category menu that seeds it. */
export function ObjectiveField({
  register,
  setValue,
  errors,
}: {
  register: UseFormRegister<ScenarioFormData>;
  setValue: UseFormSetValue<ScenarioFormData>;
  errors: FieldErrors<ScenarioFormData>;
}) {
  return (
    <Field.Root invalid={!!errors.redTeamTarget}>
      <LabelWithHelp
        label="What should the attacker try to do?"
        help={OBJECTIVE_HELP}
      />
      {/* Categories first, then the field. A blank textarea is the easiest
          way to get a weak run — the SDK plans, scores and adapts off this
          one string — so the default is to edit a concrete objective rather
          than to invent one. */}
      {/* One menu rather than a row of seven buttons: the buttons read as
          a wall competing with the field they exist to fill, and the longest
          labels clipped once the drawer narrowed. A menu also has room for
          what each category actually means, which a chip never did. */}
      <Menu.Root positioning={{ placement: "bottom-start", gutter: 4 }}>
        <Menu.Trigger asChild>
          <Button
            variant="outline"
            size="xs"
            fontWeight="normal"
            alignSelf="flex-start"
            marginBottom={2}
            aria-haspopup="menu"
            // The drawer sets colorPalette="redteam", which every descendant
            // inherits — so without this the picker's hover and focus states
            // come out red. Red is reserved for what marks the scenario as an
            // attack (the drawer edge, the type button, the chosen strategy);
            // a list of things to pick from is not one of those.
            colorPalette="gray"
          >
            Start from a category
            <ChevronDown size={13} />
          </Button>
        </Menu.Trigger>
        {/* Grouped and scrollable rather than trimmed. The three headings
            are the only place the product says what red teaming is for, so
            cutting to one shorter list would quietly narrow that to
            "security". A capped height keeps it browsable. */}
        <Menu.Content
          minWidth="360px"
          maxHeight="380px"
          overflowY="auto"
          padding={1}
          colorPalette="gray"
        >
          {RED_TEAM_OBJECTIVE_GROUPS.map((group) => (
            <Menu.ItemGroup key={group.label} title={group.label}>
              {group.objectives.map((objective) => (
                <Menu.Item
                  key={objective.label}
                  value={objective.code ?? objective.label}
                  paddingY={1.5}
                  onClick={() =>
                    setValue("redTeamTarget", objective.target, {
                      shouldDirty: true,
                    })
                  }
                >
                  <VStack align="stretch" gap={0} width="full">
                    <HStack gap={3} align="baseline" width="full">
                      <Text textStyle="sm" fontWeight="medium">
                        {objective.label}
                      </Text>
                      {objective.code ? (
                        <Text
                          textStyle="xs"
                          color="fg.subtle"
                          fontFamily="mono"
                          flexShrink={0}
                          marginStart="auto"
                        >
                          {objective.code}
                        </Text>
                      ) : null}
                    </HStack>
                    <Text textStyle="xs" color="fg.muted">
                      {objective.summary}
                    </Text>
                  </VStack>
                </Menu.Item>
              ))}
            </Menu.ItemGroup>
          ))}
        </Menu.Content>
      </Menu.Root>
      <Textarea
        {...register("redTeamTarget")}
        rows={3}
        placeholder="e.g., get the agent to reveal its system prompt"
        _placeholder={{ color: "gray.400", fontStyle: "italic" }}
      />
      <Field.ErrorText>{errors.redTeamTarget?.message}</Field.ErrorText>
    </Field.Root>
  );
}
