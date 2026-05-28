import {
  Box,
  HStack,
  RadioGroup,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";

import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

interface Props {
  organizationId: string;
}

type OptionValue = "auto" | "personal" | "project" | "governance";

interface PickerOption {
  value: OptionValue;
  label: string;
  description: string;
  /** Path the option resolves to. NULL = clear pin (auto-detection). */
  path: string | null;
}

/**
 * Default-landing-page picker for /me/configure. Persists `User.lastHomePath`
 * via api.user.setLastHomePath. Persona-aware: only surfaces destinations
 * the resolver would otherwise consider for this user — Persona-1 sees
 * Auto + Personal home; Persona-3 sees Auto + Project home; etc.
 *
 * Spec: specs/ai-gateway/governance/persona-home-content.feature
 *       (Customization — User pin)
 */
export function HomePagePicker({ organizationId }: Props) {
  const stateQuery = api.user.homePagePickerState.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const resolverQuery = api.governance.resolveHome.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  const utils = api.useUtils();
  const setMutation = api.user.setLastHomePath.useMutation({
    onSuccess: () => {
      void utils.user.homePagePickerState.invalidate({ organizationId });
      void utils.governance.resolveHome.invalidate({ organizationId });
    },
    onError: (err) => {
      toaster.create({
        title: "Could not save home preference",
        description: err.message,
        type: "error",
      });
    },
  });

  const options = useMemo<PickerOption[]>(() => {
    const firstProjectSlug = stateQuery.data?.firstProjectSlug ?? null;
    const persona = resolverQuery.data?.persona;
    const opts: PickerOption[] = [
      {
        value: "auto",
        label: "Auto",
        description: "Use my detected persona — recommended",
        path: null,
      },
      {
        value: "personal",
        label: "Personal home",
        description: "Always land on /me",
        path: "/me",
      },
    ];
    if (firstProjectSlug) {
      opts.push({
        value: "project",
        label: "Project home",
        description: `Always land on /${firstProjectSlug}/messages`,
        path: `/${firstProjectSlug}/messages`,
      });
    }
    if (persona === "governance_admin") {
      opts.push({
        value: "governance",
        label: "AI Governance overview",
        description: "Always land on the org bird's-eye dashboard",
        path: "/settings/governance",
      });
    }
    return opts;
  }, [stateQuery.data?.firstProjectSlug, resolverQuery.data?.persona]);

  const selected = useMemo<OptionValue>(() => {
    const pin = stateQuery.data?.lastHomePath;
    if (!pin) return "auto";
    const match = options.find((o) => o.path === pin);
    if (match) return match.value;
    return "auto";
  }, [stateQuery.data?.lastHomePath, options]);

  if (stateQuery.isLoading || resolverQuery.isLoading) {
    return <Skeleton height="120px" borderRadius="md" />;
  }

  const onChange = (next: OptionValue) => {
    const target = options.find((o) => o.value === next);
    if (!target) return;
    setMutation.mutate({ path: target.path });
  };

  return (
    <VStack align="stretch" gap={2} width="full">
      <RadioGroup.Root
        value={selected}
        onValueChange={(e) => onChange(e.value as OptionValue)}
      >
        <VStack align="stretch" gap={2}>
          {options.map((opt) => (
            <Box
              key={opt.value}
              borderWidth="1px"
              borderColor={
                selected === opt.value ? "blue.400" : "border.muted"
              }
              borderRadius="md"
              padding={3}
              backgroundColor={
                selected === opt.value ? "blue.50" : "transparent"
              }
              _dark={{
                backgroundColor:
                  selected === opt.value ? "blue.900" : "transparent",
              }}
              cursor="pointer"
              onClick={() => onChange(opt.value)}
              transition="all 0.1s"
            >
              <HStack gap={3} alignItems="start">
                <RadioGroup.Item value={opt.value}>
                  <RadioGroup.ItemHiddenInput />
                  <RadioGroup.ItemIndicator />
                </RadioGroup.Item>
                <VStack align="start" gap={0} flex={1} minWidth={0}>
                  <Text fontSize="sm" fontWeight="medium">
                    {opt.label}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {opt.description}
                  </Text>
                </VStack>
                <Spacer />
              </HStack>
            </Box>
          ))}
        </VStack>
      </RadioGroup.Root>
      {setMutation.isPending && (
        <Text fontSize="xs" color="fg.muted">
          Saving…
        </Text>
      )}
    </VStack>
  );
}
