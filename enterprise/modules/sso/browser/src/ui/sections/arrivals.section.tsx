// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Who this connection admits (ADR-117 §3). The question nobody was asked:
 * registration states `refuse`, so a person signing in through their own
 * organization's provider was authenticated and handed a workspace of their
 * own. Asked here, where a proved domain makes the widest answer mean
 * something, and going live waits for it.
 */
import { Box, Button, HStack, RadioGroup, Text, VStack } from "@chakra-ui/react";
import type { SsoArrivalPolicy, SsoConnectionLifecycleState } from "@langwatch/identity-contract";
import { useState } from "react";

import {
  ARRIVAL_ANSWERS,
  ARRIVAL_COPY,
  isSsoArrivalPolicy,
  SSO_POLICY_BY_ANSWER,
  type ArrivalAnswer,
} from "../../model/arrivals.ts";
import { SettingsCard } from "../elements/settings-card.tsx";

/**
 * The answer this door recommends, said as a mark rather than by position:
 * the same three answers are offered in the same order by the join policy,
 * which recommends none of them.
 */
const RECOMMENDED: ArrivalAnswer = "open";

/** Nothing to decide until a domain is proved; a paused connection still may. */
const CONFIGURABLE: readonly SsoConnectionLifecycleState[] = ["VERIFIED", "ACTIVE", "SUSPENDED"];

export function ArrivalsSection({
  connectionState,
  canManage,
  policy,
  decided,
  saving = false,
  onSave,
}: {
  connectionState: SsoConnectionLifecycleState;
  canManage: boolean;
  /** What the connection admits today. */
  policy: SsoArrivalPolicy;
  /** Whether anybody has answered yet, which is what going live waits for. */
  decided: boolean;
  saving?: boolean;
  onSave: (policy: SsoArrivalPolicy) => void;
}) {
  const [selected, setSelected] = useState<SsoArrivalPolicy>(policy);
  const unchanged = selected === policy;
  const canConfigure = CONFIGURABLE.includes(connectionState);

  return (
    <SettingsCard
      title="Who gets in"
      hint="What happens when somebody we have never seen signs in through your identity provider."
      testId="connection-arrivals"
    >
      {!canConfigure && (
        <Text color="fg.muted" fontSize="sm" as="output">
          Verify a domain to configure who can join.
        </Text>
      )}

      <RadioGroup.Root
        value={selected}
        onValueChange={(event) => {
          // An unrecognised answer leaves the door where it was: admission is
          // never the fallback for a value we could not read.
          if (isSsoArrivalPolicy(event.value)) setSelected(event.value);
        }}
      >
        <VStack align="stretch" gap={3}>
          {ARRIVAL_ANSWERS.map((answer) => (
            <ArrivalChoice
              key={answer}
              answer={answer}
              disabled={!canManage || !canConfigure || saving}
            />
          ))}
        </VStack>
      </RadioGroup.Root>

      {/* Automatic admission still rests on current domain ownership proof. */}
      {selected === "admit" && (
        <Box
          borderLeftWidth="2px"
          borderColor="border.emphasized"
          paddingLeft={3}
          maxWidth="72ch"
          minWidth={0}
        >
          <Text color="fg.muted" fontSize="xs" lineHeight="1.6">
            Nobody approves each person, and nobody has to: the only addresses that reach this
            connection are the ones on a domain you verified. A domain whose proof lapses stops
            vouching for anybody new.
          </Text>
        </Box>
      )}

      {/* Which door this is, and no pointer at the other one: the overview can
          see both and is where the pair is explained. */}
      <Text color="fg.subtle" fontSize="xs">
        This answers people who sign in through your identity provider.
      </Text>

      {canManage && canConfigure && (!decided || !unchanged) && (
        <HStack>
          <Button
            size="sm"
            colorPalette="orange"
            loading={saving}
            loadingText="Saving choice"
            onClick={() => onSave(selected)}
          >
            {decided ? "Save" : "Confirm choice"}
          </Button>
          {!unchanged && (
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setSelected(policy)}>
              Cancel
            </Button>
          )}
        </HStack>
      )}
    </SettingsCard>
  );
}

/** One answer, in the words both doors share, with its own consequence. */
function ArrivalChoice({ answer, disabled }: { answer: ArrivalAnswer; disabled: boolean }) {
  const value = SSO_POLICY_BY_ANSWER[answer];
  const copy = ARRIVAL_COPY[answer];

  return (
    <RadioGroup.Item value={value} disabled={disabled}>
      <RadioGroup.ItemHiddenInput data-testid={`arrivals-${value}`} />
      <RadioGroup.ItemIndicator />
      <RadioGroup.ItemText minWidth={0} whiteSpace="normal">
        <VStack align="start" gap={0}>
          <HStack gap={2} flexWrap="wrap">
            <Text fontSize="sm" fontWeight="medium">
              {copy.label}
            </Text>
            {answer === RECOMMENDED && (
              <Text color="fg.subtle" fontSize="xs" data-testid="arrivals-recommended">
                Usually this one
              </Text>
            )}
          </HStack>
          <Text color="fg.muted" fontSize="xs">
            {copy.help}
          </Text>
        </VStack>
      </RadioGroup.ItemText>
    </RadioGroup.Item>
  );
}
