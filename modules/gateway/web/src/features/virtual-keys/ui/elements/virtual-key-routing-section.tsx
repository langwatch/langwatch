import { HStack, Text, VStack } from "@chakra-ui/react";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { SmallLabel } from "@langwatch/design-system/small-label";

/**
 * What happens when the provider serving a request fails. One decision
 * expressed as (routingMode, routingPolicyId) on the wire; the drawer
 * keeps them as one radio choice so they cannot contradict each other.
 */
export type VirtualKeyRoutingValue =
  | { mode: "NONE" | "FALLBACK_ALL"; policyId: null }
  | { mode: "POLICY"; policyId: string };

export const ROUTING_NONE: VirtualKeyRoutingValue = {
  mode: "NONE",
  policyId: null,
};

export function routingValueFromKey(key: {
  routingMode?: "NONE" | "FALLBACK_ALL" | "POLICY" | null;
  routingPolicyId: string | null;
}): VirtualKeyRoutingValue {
  if (key.routingMode === "POLICY" && key.routingPolicyId) {
    return { mode: "POLICY", policyId: key.routingPolicyId };
  }
  if (key.routingMode === "FALLBACK_ALL") {
    return { mode: "FALLBACK_ALL", policyId: null };
  }
  // Rows that predate routingMode carry the old implicit default through
  // their policy reference; anything else is the explicit no-fallback.
  if (!key.routingMode && key.routingPolicyId) {
    return { mode: "POLICY", policyId: key.routingPolicyId };
  }
  return ROUTING_NONE;
}

function encode(value: VirtualKeyRoutingValue): string {
  return value.mode === "POLICY" ? `POLICY:${value.policyId}` : value.mode;
}

function decode(raw: string): VirtualKeyRoutingValue {
  if (raw.startsWith("POLICY:")) {
    return { mode: "POLICY", policyId: raw.slice("POLICY:".length) };
  }
  return raw === "FALLBACK_ALL" ? { mode: "FALLBACK_ALL", policyId: null } : ROUTING_NONE;
}

/**
 * Routing choice for the virtual-key drawers. "No fallback" leads and is
 * the default for new keys: failing over sends the request, and its data,
 * to a different vendor: a decision worth making on purpose rather than
 * inheriting from a blank field.
 */
export function VirtualKeyRoutingSection({
  value,
  onChange,
  policies,
}: {
  value: VirtualKeyRoutingValue;
  onChange: (next: VirtualKeyRoutingValue) => void;
  policies: Array<{ id: string; name: string }>;
}) {
  return (
    <VStack align="start" width="full" gap={1.5}>
      <HStack gap={1} alignItems="center">
        <SmallLabel>Routing</SmallLabel>
        <FieldInfoTooltip
          description="What happens when the provider serving a request fails. 'No fallback' surfaces the provider's error to the caller. 'Fall back' retries the request on the next eligible provider, which sends it to a different vendor. A routing policy pins an explicit ordered provider list."
          docHref="/ai-gateway/governance/routing-policies"
          testId="vk-routing-info"
        />
      </HStack>
      <RadioGroup
        value={encode(value)}
        onValueChange={(d: { value: string | null }) => {
          if (d.value) onChange(decode(d.value));
        }}
        size="sm"
      >
        <VStack align="start" gap={1.5}>
          <Radio value="NONE" data-testid="vk-routing-none">
            <Text fontSize="sm">Default: no fallback</Text>
          </Radio>
          <Radio value="FALLBACK_ALL" data-testid="vk-routing-fallback-all">
            <Text fontSize="sm">Fall back to all eligible providers</Text>
          </Radio>
          {(value.mode === "POLICY" &&
          value.policyId &&
          !policies.some((p) => p.id === value.policyId)
            ? // The stored policy is not in the list (still loading, or
              // deleted since). Render it anyway: a radio group with a
              // selection that matches no radio reads as "no routing",
              // while the key would still submit POLICY.
              [...policies, { id: value.policyId, name: "Current policy" }]
            : policies
          ).map((p) => (
            <Radio key={p.id} value={`POLICY:${p.id}`} data-testid={`vk-routing-policy-${p.id}`}>
              <Text fontSize="sm">{p.name}</Text>
            </Radio>
          ))}
        </VStack>
      </RadioGroup>
    </VStack>
  );
}
