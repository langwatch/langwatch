/**
 * Upgrade to Growth: one number, the full seats, then Stripe Checkout.
 * @see specs/licensing/seat-buying.feature
 */
import { Dialog } from "@langwatch/design-system/dialog";
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Check, Info, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { type SeatPrice, upgradeMinimumHint, upgradeTotal } from "../../model/seat-purchase.ts";
import { SeatStepper } from "../elements/seat-stepper.tsx";

export function UpgradeSeatsDialog({
  open,
  onClose,
  minimumSeats,
  price,
  onContinue,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  /** The people already in the organization: the start and the floor. */
  minimumSeats: number;
  price: SeatPrice;
  /** Starts the checkout; the dialog stays open if it could not. */
  onContinue: (seats: number) => void;
  isLoading: boolean;
}) {
  const floor = Math.max(1, minimumSeats);
  const [seats, setSeats] = useState(floor);
  useEffect(() => {
    if (open) setSeats(floor);
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
        onClick: () => onContinue(seats),
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
