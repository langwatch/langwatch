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
import { api } from "~/utils/api";
import { InlineRefusal } from "./refusals";

/**
 * Who this connection admits (ADR-117 §3).
 *
 * THE QUESTION NOBODY WAS ASKED. `allowsJit` defaulted to false and the
 * journey never mentioned it, so every connection in the database forbade
 * provisioning — which meant a person signing in through their own
 * organization's identity provider was authenticated and then handed a brand
 * new workspace of their own. That is the opposite of what registering a
 * connection means, and nobody chose it: it was a default nobody surfaced.
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
 */
const OPTIONS: Array<{
  value: SsoArrivalPolicy;
  label: string;
  help: string;
}> = [
  {
    value: "admit",
    label: "They join, on a domain you proved",
    help: "The usual answer. Only addresses on a domain this connection proved ever reach it.",
  },
  {
    value: "request",
    label: "They wait for you",
    help: "They keep the account they just signed in with, and you answer the request in your Directory.",
  },
  {
    value: "refuse",
    label: "Only people already here",
    help: "Anybody else is turned away. Invitations still work.",
  },
];

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

  const chosen = OPTIONS.find((option) => option.value === selected);
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
          {OPTIONS.map((option) => (
            <RadioGroup.Item
              key={option.value}
              value={option.value}
              disabled={!canManage || save.isPending}
            >
              <RadioGroup.ItemHiddenInput
                data-testid={`arrivals-${option.value}`}
              />
              <RadioGroup.ItemIndicator />
              <RadioGroup.ItemText>
                <VStack align="start" gap={0}>
                  <Text fontSize="sm" fontWeight="medium">
                    {option.label}
                  </Text>
                  <Text color="fg.muted" fontSize="xs">
                    {option.help}
                  </Text>
                </VStack>
              </RadioGroup.ItemText>
            </RadioGroup.Item>
          ))}
        </VStack>
      </RadioGroup.Root>

      {/* THE ONE ANSWER THAT ADMITS SOMEBODY WITH NOBODY IN THE LOOP names
          what it rests on, where it is being chosen. A reader deciding this
          is deciding how much they trust their own domain proof, and the
          proof is the thing that makes the answer safe. */}
      {chosen?.value === "admit" && (
        <Box
          borderLeftWidth="2px"
          borderColor="border.emphasized"
          paddingLeft={3}
        >
          <Text color="fg.muted" fontSize="xs" lineHeight="1.6">
            Nobody approves each person, and nobody has to: the only addresses
            that reach this connection are the ones on a domain you proved in
            step 2. A domain whose proof lapses stops vouching for anybody new.
          </Text>
        </Box>
      )}

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
