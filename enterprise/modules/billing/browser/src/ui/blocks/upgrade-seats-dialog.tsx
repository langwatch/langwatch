/**
 * Upgrade to Growth: the full seats and the data retention, then Stripe Checkout.
 * @see specs/licensing/seat-buying.feature
 * @see specs/billing/retention-at-upgrade.feature
 */
import { Dialog } from "@langwatch/design-system/dialog";
import {
  Box,
  createListCollection,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Check, Info, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { type Currency, EXCLUDING_VAT } from "../../model/billing-plans.ts";
import {
  GROWTH_INCLUDED_RETENTION_DAYS,
  GROWTH_RETENTION_OPTIONS,
  type RetentionEstimateState,
  retentionStorageLine,
} from "../../model/retention-choice.ts";
import { type SeatPrice, upgradeMinimumHint, upgradeTotal } from "../../model/seat-purchase.ts";
import { SeatStepper } from "../elements/seat-stepper.tsx";

const retentionItems = GROWTH_RETENTION_OPTIONS.map((option) => ({
  label: option.label,
  value: String(option.days),
}));
const retentionCollection = createListCollection({ items: retentionItems });

/** What the picked retention adds: nothing up to 90 days, else storage priced per GB. */
function RetentionStorageNote({
  retentionDays,
  currency,
  estimate,
}: {
  retentionDays: number;
  currency: Currency;
  estimate: RetentionEstimateState;
}) {
  const line = retentionStorageLine({ retentionDays, currency, estimate });
  if (line.kind === "included") {
    return (
      <HStack gap={2} color="fg.muted" data-testid="upgrade-retention-included">
        <Check size={14} />
        <Text textStyle="bodySm">Included in Growth</Text>
      </HStack>
    );
  }
  return (
    <VStack
      align="stretch"
      gap={1}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      paddingX={4}
      paddingY={3}
      data-testid="upgrade-retention-storage"
    >
      <HStack justify="space-between" align="baseline">
        <Text textStyle="bodySm" fontWeight="semibold">
          Storage above 90 days
        </Text>
        <Text textStyle="bodySm" color="fg.muted" fontVariantNumeric="tabular-nums">
          {line.unitPrice}
        </Text>
      </HStack>
      {line.kind === "loading" && (
        <Skeleton height="4" width="60%" data-testid="upgrade-retention-estimate-loading" />
      )}
      {line.kind === "estimate" && (
        <Text
          textStyle="bodySm"
          fontVariantNumeric="tabular-nums"
          data-testid="upgrade-retention-estimate"
        >
          {line.amount} {EXCLUDING_VAT}
        </Text>
      )}
      <Text textStyle="bodySm" color="fg.muted">
        Charged only for data older than 90 days.
      </Text>
    </VStack>
  );
}

export function UpgradeSeatsDialog({
  open,
  onClose,
  minimumSeats,
  price,
  currency,
  retentionEstimate,
  onContinue,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  /** The people already in the organization: the start and the floor. */
  minimumSeats: number;
  price: SeatPrice;
  currency: Currency;
  /** The organization's storage read, for the price of a retention above 90 days. */
  retentionEstimate: RetentionEstimateState;
  /** Starts the checkout; the dialog stays open if it could not. */
  onContinue: (input: { seats: number; retentionDays: number }) => void;
  isLoading: boolean;
}) {
  const floor = Math.max(1, minimumSeats);
  const [seats, setSeats] = useState(floor);
  const [retentionDays, setRetentionDays] = useState<number>(GROWTH_INCLUDED_RETENTION_DAYS);
  useEffect(() => {
    if (!open) return;
    setSeats(floor);
    setRetentionDays(GROWTH_INCLUDED_RETENTION_DAYS);
  }, [open, floor]);

  const { total, note, breakdown } = upgradeTotal({ seats, price });
  const hint = seats <= floor ? upgradeMinimumHint(floor) : undefined;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Upgrade to Growth"
      busy={isLoading}
      data-testid="upgrade-seats-dialog"
      primaryAction={{
        label: "Continue to checkout",
        onClick: () => onContinue({ seats, retentionDays }),
        loading: isLoading,
      }}
    >
      <VStack align="stretch" gap={4}>
        <HStack justify="space-between">
          <Text fontWeight="semibold">Full seats</Text>
          <SeatStepper
            value={seats}
            minimum={floor}
            onChange={setSeats}
            label="Full seats"
            testId="upgrade-seats-stepper"
          />
        </HStack>
        {hint && (
          <HStack gap={2} align="start" color="fg.muted" data-testid="upgrade-seats-minimum">
            <Box flexShrink={0} paddingTop={0.5}>
              <Info size={14} />
            </Box>
            <Text textStyle="bodySm">{hint}</Text>
          </HStack>
        )}
        <VStack align="stretch" gap={1.5}>
          <HStack justify="space-between">
            <Text fontWeight="semibold">Data retention</Text>
            <Select.Root
              data-testid="upgrade-retention-select"
              collection={retentionCollection}
              size="sm"
              width="140px"
              value={[String(retentionDays)]}
              onValueChange={(details) => {
                const days = Number(details.value[0]);
                if (Number.isFinite(days)) setRetentionDays(days);
              }}
            >
              <Select.Trigger aria-label="Data retention">
                <Select.ValueText />
              </Select.Trigger>
              <Select.Content paddingY={2}>
                {retentionItems.map((item) => (
                  <Select.Item key={item.value} item={item}>
                    {item.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </HStack>
          <Text textStyle="bodySm" color="fg.muted" data-testid="upgrade-retention-change-note">
            You can change the retention period anytime
          </Text>
        </VStack>
        <RetentionStorageNote
          retentionDays={retentionDays}
          currency={currency}
          estimate={retentionEstimate}
        />
        <HStack
          justify="space-between"
          align="baseline"
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          paddingX={4}
          paddingY={3}
          data-testid="upgrade-seats-total"
        >
          <HStack gap={2} align="baseline">
            <Text fontSize="2xl" fontWeight="semibold" fontVariantNumeric="tabular-nums">
              {total}
            </Text>
            <Text textStyle="bodySm" color="fg.muted">
              {note}
            </Text>
          </HStack>
          <Text textStyle="bodySm" color="fg.muted" fontVariantNumeric="tabular-nums">
            {breakdown}
          </Text>
        </HStack>
        <VStack align="stretch" gap={1.5} color="fg.muted" data-testid="upgrade-seats-included">
          <HStack gap={2}>
            <Check size={14} />
            <Text textStyle="bodySm">200,000 events a month included. Lite members free.</Text>
          </HStack>
          <HStack gap={2}>
            <Users size={14} />
            <Text textStyle="bodySm">Invite people after checkout.</Text>
          </HStack>
        </VStack>
      </VStack>
    </Dialog>
  );
}
