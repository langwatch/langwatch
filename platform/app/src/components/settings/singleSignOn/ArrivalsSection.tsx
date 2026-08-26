import {
  Box,
  Button,
  HStack,
  RadioGroup,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SsoArrivalPolicy } from "@langwatch/identity";
import { useState } from "react";
import {
  ARRIVAL_ANSWERS,
  ARRIVAL_COPY,
  type ArrivalAnswer,
  SSO_POLICY_BY_ANSWER,
} from "~/features/sso/logic/arrivals";
import { api } from "~/utils/api";
import { InlineRefusal } from "./refusals";

/**
 * Who this connection admits (ADR-117 §3).
 *
 * THE QUESTION NOBODY WAS ASKED. Registration states `refuse` and the
 * journey never mentioned it, so every connection forbade provisioning —
 * which meant a person signing in through their own organization's identity
 * provider was authenticated and then handed a brand new workspace of their
 * own. That is the opposite of what registering a connection means, and
 * nobody chose it: it was a default nobody surfaced. This step surfaces it,
 * which is why going live waits for it.
 *
 * IT IS ASKED HERE AND NOT AT REGISTRATION, because the first answer is
 * "anybody on a domain you proved" and that means nothing until a domain is
 * proved. By this step one is.
 *
 * WHAT BOUNDS `admit` IS NOT THIS SETTING. Routing only ever sends an address
 * to a connection whose domain that connection PROVED, so the widest answer
 * here already means "anybody on a domain you proved and configured a provider
 * for" — never "anybody at all". Saying so is the difference between an
 * administrator choosing it and an administrator worrying about it.
 *
 * ONE QUESTION, TWO DOORS, ONE VOCABULARY. The overview's join policy asks
 * the same three answers of the arrivals single sign-on does not catch, so
 * the options wear the same words in both places — a reader who has answered
 * one should recognise the other. What differs is the door, and each control
 * says which one it is and where the other lives.
 */
/**
 * The answer this door recommends, said as a mark rather than by position.
 *
 * It used to be the words "The usual answer" on the first option, which made
 * the ORDER carry the endorsement — and the other door, which orders the same
 * three answers the same way but recommends none of them, inherited an
 * emphasis nobody chose. Recommending it out loud lets both doors share one
 * order without sharing one opinion.
 */
const RECOMMENDED: ArrivalAnswer = "open";

export function ArrivalsSection({
  organizationId,
  connectionId,
  canManage,
  policy,
}: {
  organizationId: string;
  connectionId: string;
  canManage: boolean;
  policy: SsoArrivalPolicy;
}) {
  const [selected, setSelected] = useState<SsoArrivalPolicy>(policy);
  const utils = api.useUtils();
  const save = api.ssoSetup.setArrivals.useMutation({
    onSuccess: async () => {
      await utils.ssoSetup.getSetup.invalidate();
    },
  });

  const unchanged = selected === policy;

  return (
    <VStack align="stretch" gap={3}>
      <Text color="fg.muted" fontSize="sm">
        Somebody signs in through your identity provider and we have never seen
        them before. This is what happens next.
      </Text>

      <InlineRefusal error={save.error} what="Saving who this admits" />

      <RadioGroup.Root
        value={selected}
        onValueChange={(event) =>
          setSelected((event.value ?? "admit") as SsoArrivalPolicy)
        }
      >
        <VStack align="stretch" gap={3}>
          {ARRIVAL_ANSWERS.map((answer) => {
            const value = SSO_POLICY_BY_ANSWER[answer];
            const copy = ARRIVAL_COPY[answer];
            return (
              <RadioGroup.Item
                key={value}
                value={value}
                disabled={!canManage || save.isPending}
              >
                <RadioGroup.ItemHiddenInput data-testid={`arrivals-${value}`} />
                <RadioGroup.ItemIndicator />
                <RadioGroup.ItemText>
                  <VStack align="start" gap={0}>
                    <HStack gap={2}>
                      <Text fontSize="sm" fontWeight="medium">
                        {copy.label}
                      </Text>
                      {answer === RECOMMENDED && (
                        <Text
                          color="fg.subtle"
                          fontSize="xs"
                          data-testid="arrivals-recommended"
                        >
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
          })}
        </VStack>
      </RadioGroup.Root>

      {/* THE ONE ANSWER THAT ADMITS SOMEBODY WITH NOBODY IN THE LOOP names
          what it rests on, where it is being chosen. A reader deciding this
          is deciding how much they trust their own domain proof, and the
          proof is the thing that makes the answer safe. */}
      {selected === "admit" && (
        <Box
          borderLeftWidth="2px"
          borderColor="border.emphasized"
          paddingLeft={3}
        >
          <Text color="fg.muted" fontSize="xs" lineHeight="1.6">
            Nobody approves each person, and nobody has to: the only addresses
            that reach this connection are the ones on a domain you verified in
            step 2. A domain whose proof lapses stops vouching for anybody new.
          </Text>
        </Box>
      )}

      {/* WHICH DOOR THIS IS, and no pointer at the other one. It used to send
          the reader to the Authentication overview for the join policy, which
          is an exit ramp in the middle of a six-step journey — and the
          overview was sending them back here, so the two made a loop. The
          overview can see both doors and is where the pair gets explained;
          this step, which can see one, names only the one it is. */}
      <Text color="fg.subtle" fontSize="xs">
        This answers people who sign in through your identity provider.
      </Text>

      {canManage && !unchanged && (
        <HStack>
          <Button
            size="sm"
            colorPalette="orange"
            loading={save.isPending}
            onClick={() =>
              save.mutate({ organizationId, connectionId, policy: selected })
            }
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => setSelected(policy)}
          >
            Cancel
          </Button>
        </HStack>
      )}
    </VStack>
  );
}
