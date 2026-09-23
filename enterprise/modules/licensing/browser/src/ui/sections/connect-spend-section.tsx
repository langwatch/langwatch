import { Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import type { ConnectContractView } from "@langwatch/enterprise-licensing-contract";
import { useState } from "react";

import { connectApi } from "../../behavior/connect-api.ts";
import { formatPeriodStart, formatUsd } from "../../model/hosted-services.ts";
import { useLicensingHost } from "../../model/licensing-host.ts";
import { Figure, SettingsBlock } from "../elements/settings-block.tsx";
import type { ConnectEnabledStatus } from "./connect-status.ts";

/** Said in place of a figure while LangWatch cannot report spend. */
const SPEND_UNAVAILABLE = "Spend is not available right now";

/** What this install has spent on hosted services, against the cap it stops at. */
export function ConnectSpendSection({
  organizationId,
  status,
  onSaved,
}: {
  organizationId: string;
  status: ConnectEnabledStatus;
  onSaved: () => void;
}) {
  const host = useLicensingHost();
  const usage = status.usage;
  if (!usage) return null;
  const contract = usage.contract;

  return (
    <SettingsBlock
      title="Spend"
      description="What this install has spent on hosted services, and the cap it stops at."
      testId="connect-spend"
    >
      {contract ? (
        <VStack width="full" align="stretch" gap={5}>
          <SpendFigures contract={contract} spendAvailable={usage.spendAvailable} />
          {host.canManageOrganization() ? (
            <CapField organizationId={organizationId} contract={contract} onSaved={onSaved} />
          ) : null}
        </VStack>
      ) : (
        <Text fontSize="sm" color="fg.muted">
          No spend limit has been agreed for hosted services yet. Contact LangWatch to agree one.
        </Text>
      )}
    </SettingsBlock>
  );
}

function SpendFigures({
  contract,
  spendAvailable,
}: {
  contract: ConnectContractView;
  spendAvailable: boolean;
}) {
  const periodStart = formatPeriodStart({ value: contract.periodStartedAt, fallback: "" });
  return (
    <VStack width="full" align="stretch" gap={2}>
      <HStack width="full" gap={10} align="start" flexWrap="wrap">
        <Figure
          label="Spent"
          value={spendAvailable ? formatUsd(contract.spentUsd) : SPEND_UNAVAILABLE}
        />
        <Figure label="Cap" value={formatUsd(contract.capUsd)} />
        <Figure
          label="Remaining"
          value={spendAvailable ? formatUsd(contract.remainingUsd) : SPEND_UNAVAILABLE}
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

function CapField({
  organizationId,
  contract,
  onSaved,
}: {
  organizationId: string;
  contract: ConnectContractView;
  onSaved: () => void;
}) {
  const host = useLicensingHost();
  const [draft, setDraft] = useState(contract.capUsd.toString());
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const setCap = connectApi.connect.setCap.useMutation({
    onSuccess: () => {
      setFailure(undefined);
      onSaved();
    },
    onError: (error: unknown) =>
      setFailure(host.describeFailure({ error, fallbackTitle: "Couldn't save the cap" })),
  });
  const parsed = Number(draft);
  const isValid = draft.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;

  return (
    <Field.Root invalid={failure !== undefined} maxWidth="360px">
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
      {failure !== undefined ? (
        <Field.ErrorText>{failure}</Field.ErrorText>
      ) : (
        <Field.HelperText>Hosted services stop once spend reaches this cap.</Field.HelperText>
      )}
    </Field.Root>
  );
}
