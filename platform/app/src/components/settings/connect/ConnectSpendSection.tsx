import { Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { SettingsSection } from "~/components/settings/SettingsSection";
import { resolveErrorCopy } from "~/features/errors";
import { api } from "~/utils/api";

import {
  type ConnectContractView,
  type ConnectEnabledView,
  formatPeriodStart,
  formatUsd,
} from "./connectStatus";

interface ConnectSpendSectionProps {
  organizationId: string;
  status: ConnectEnabledView;
  canManage: boolean;
  onSaved: () => void;
}

/** Said in place of a figure while LangWatch cannot report spend. */
const SPEND_UNAVAILABLE = "Spend is not available right now";

/**
 * What this install has spent on hosted services, against the cap it stops at.
 */
export function ConnectSpendSection({
  organizationId,
  status,
  canManage,
  onSaved,
}: ConnectSpendSectionProps) {
  const usage = status.usage;
  if (!usage) return null;

  const contract = usage.contract;

  return (
    <SettingsSection
      title="Spend"
      description="What this install has spent on hosted services, and the cap it stops at."
      testId="connect-spend"
    >
      {contract ? (
        <VStack width="full" align="stretch" gap={5}>
          <SpendFigures
            contract={contract}
            spendAvailable={usage.spendAvailable}
          />
          {canManage ? (
            <CapField
              organizationId={organizationId}
              contract={contract}
              onSaved={onSaved}
            />
          ) : null}
        </VStack>
      ) : (
        <Text fontSize="sm" color="fg.muted">
          No spend limit has been agreed for hosted services yet. Contact
          LangWatch to agree one.
        </Text>
      )}
    </SettingsSection>
  );
}

function SpendFigures({
  contract,
  spendAvailable,
}: {
  contract: ConnectContractView;
  spendAvailable: boolean;
}) {
  const periodStart = formatPeriodStart(contract.periodStartedAt);

  return (
    <VStack width="full" align="stretch" gap={2}>
      <HStack width="full" gap={10} align="start" flexWrap="wrap">
        <Figure
          label="Spent"
          value={spendAvailable ? formatUsd(contract.spentUsd) : null}
        />
        <Figure label="Cap" value={formatUsd(contract.capUsd)} />
        <Figure
          label="Remaining"
          value={spendAvailable ? formatUsd(contract.remainingUsd) : null}
        />
      </HStack>
      {periodStart ? (
        <Text fontSize="sm" color="fg.muted">
          For the period that started on {periodStart}.
        </Text>
      ) : null}
    </VStack>
  );
}

function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <VStack align="start" gap={0.5}>
      <Text fontSize="sm" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="lg" fontWeight={600}>
        {value ?? SPEND_UNAVAILABLE}
      </Text>
    </VStack>
  );
}

function CapField({
  organizationId,
  contract,
  onSaved,
}: {
  organizationId: string;
  contract: ConnectContractView;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(contract.capUsd.toString());
  const [failure, setFailure] = useState<unknown>(null);

  const setCap = api.connect.setCap.useMutation({
    onSuccess: () => {
      setFailure(null);
      onSaved();
    },
    onError: (error: unknown) => setFailure(error),
  });

  const parsed = Number(draft);
  const isValid =
    draft.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;
  const copy = failure
    ? resolveErrorCopy({
        error: failure,
        fallbackTitle: "Couldn't save the cap",
      })
    : null;

  return (
    <Field.Root invalid={!!copy} maxWidth="360px">
      <Field.Label>Spending cap in USD</Field.Label>
      <HStack width="full" gap={2}>
        <Input
          value={draft}
          inputMode="decimal"
          data-testid="connect-cap-input"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          loading={setCap.isPending}
          disabled={!isValid}
          data-testid="connect-cap-save"
          onClick={() => setCap.mutate({ organizationId, capUsd: parsed })}
        >
          Save
        </Button>
      </HStack>
      {copy ? (
        <Field.ErrorText>
          <VStack align="start" gap={0.5}>
            <Text>{copy.title}</Text>
            {copy.description ? <Text>{copy.description}</Text> : null}
          </VStack>
        </Field.ErrorText>
      ) : (
        <Field.HelperText>
          Hosted services stop once spend reaches this cap.
        </Field.HelperText>
      )}
    </Field.Root>
  );
}
