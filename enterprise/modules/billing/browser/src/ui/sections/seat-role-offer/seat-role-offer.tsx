// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The full seat a role change needs, offered in place under the role field. Lent to the member
 * drawer by `SeatRoleOfferToken`: organization owns the change, billing prices the seat and says
 * what happened. specs/licensing/role-change-seat.feature.
 */
import { describeError } from "@langwatch/browser-host/errors";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { Alert, Button, HStack, List, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { SeatRoleOfferProps } from "@langwatch/enterprise-billing-client";
import type { SeatOffer } from "@langwatch/enterprise-billing-contract";
import { Clock, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { billingApi } from "../../../behavior/billing-api.ts";
import { billingDay } from "../../../model/seat-change-summary.ts";
import { withArticle } from "../../../model/seat-purchase.ts";

type ChargeOffer = Extract<SeatOffer, { kind: "charge" }>;
type BuyableOffer = Extract<SeatOffer, { kind: "charge" | "checkout" }>;

const SUPPORT_MAIL = "mailto:support@langwatch.ai?subject=We%20couldn%27t%20add%20a%20seat";
const SEAT_REQUEST_MAIL = "mailto:support@langwatch.ai?subject=Add%20a%20seat%20to%20our%20plan";

/** "/mo" after a monthly price, "/yr" after a yearly one, whichever word the provider uses. */
function perPeriod(interval: string): string {
  if (interval === "year" || interval === "annual") return "/yr";
  if (interval === "month" || interval === "monthly") return "/mo";
  return "";
}

function offerButtonLabel({
  offer,
  memberName,
  roleLabel,
}: {
  offer: BuyableOffer;
  memberName: string;
  roleLabel: string;
}): string {
  const base = `Add 1 seat and make ${memberName} ${roleLabel}`;
  if (offer.kind === "checkout") return base;
  const per = perPeriod(offer.billingInterval);
  return `${base} · ${offer.formattedAmountDue} today, then ${offer.formattedRecurringTotal}${per}`;
}

function SeatOfferCard({
  offer,
  memberName,
  roleLabel,
  busy,
  onConfirm,
}: {
  offer: BuyableOffer;
  memberName: string;
  roleLabel: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const charge: ChargeOffer | undefined = offer.kind === "charge" ? offer : undefined;
  const renews = charge?.renewsAt != null ? billingDay(charge.renewsAt) : undefined;
  return (
    <Card
      variant="nested"
      tone="yellow"
      titleLevel={3}
      icon={<Users size={16} />}
      title="No free full seat."
      description={
        charge
          ? `Add 1 for ${charge.formattedSeatPrice}${perPeriod(charge.billingInterval)}.`
          : `${roleLabel} needs one, and every full seat is in use.`
      }
    >
      <VStack align="stretch" gap={3} data-testid="seat-role-offer">
        {charge && (
          <HStack justify="space-between" fontSize="sm">
            <Text>{renews ? `Today, prorated to ${renews}` : "Today, prorated"}</Text>
            <Text fontWeight="semibold">{charge.formattedAmountDue}</Text>
          </HStack>
        )}
        <Button colorPalette="accent" width="full" loading={busy} onClick={onConfirm}>
          {offerButtonLabel({ offer, memberName, roleLabel })}
        </Button>
        <Text fontSize="sm" color="fg.muted">
          {charge
            ? `Then ${charge.formattedRecurringTotal}${perPeriod(charge.billingInterval)} for ${charge.newTotalSeats} seats${renews ? ` from ${renews}` : ""}. `
            : ""}
          Or move someone else to Lite instead.
        </Text>
      </VStack>
    </Card>
  );
}

function SeatAddedNotice({
  confirmed,
  organizationName,
  memberName,
  roleLabel,
}: {
  confirmed: BuyableOffer | undefined;
  organizationName: string;
  memberName: string;
  roleLabel: string;
}) {
  const paid = confirmed?.kind === "charge" ? `Paid ${confirmed.formattedAmountDue}. ` : "";
  const seats = confirmed
    ? `${organizationName} has ${confirmed.newTotalSeats} full seats, all in use. `
    : "";
  return (
    <Banner
      status="success"
      title={`${memberName} is now ${withArticle(roleLabel)}`}
      data-testid="seat-role-done"
    >
      {`${paid}${seats}A receipt is on its way by email.`}
    </Banner>
  );
}

/** Billing held on our side: nothing the customer can fix, so the notice asks nothing of them. */
function SeatHeldNotice({
  organizationName,
  memberName,
  currentRoleLabel,
}: {
  organizationName: string;
  memberName: string;
  currentRoleLabel: string;
}) {
  return (
    <VStack align="start" gap={2} data-testid="seat-role-stuck">
      <Banner status="info" icon={<Clock size={16} />} title="We couldn't add the seat yet">
        {`Something on our side is holding ${organizationName}'s billing. We were alerted automatically and are fixing it.`}
        <List.Root as="ul" paddingStart={4} marginTop={2}>
          <List.Item>Nothing was charged.</List.Item>
          <List.Item>{`${memberName} is still ${withArticle(currentRoleLabel)}.`}</List.Item>
          <List.Item>We'll email you when it's done, usually the same working day.</List.Item>
        </List.Root>
      </Banner>
      <Button asChild size="sm" variant="outline">
        <a href={SUPPORT_MAIL}>Contact support</a>
      </Button>
    </VStack>
  );
}

/** A plan on custom terms: our team changes its seats, so the drawer points to support. */
function SeatSupportNotice({
  organizationName,
  memberName,
  currentRoleLabel,
}: {
  organizationName: string;
  memberName: string;
  currentRoleLabel: string;
}) {
  return (
    <Banner
      status="info"
      title={`Seats on ${organizationName}'s plan are changed by our team`}
      data-testid="seat-role-support"
      action={
        <BannerAction asChild>
          <a href={SEAT_REQUEST_MAIL}>Contact support</a>
        </BannerAction>
      }
    >
      {`Your plan has custom terms, so we add seats for you. Nothing was charged and ${memberName} is still ${withArticle(currentRoleLabel)}.`}
    </Banner>
  );
}

export function SeatRoleOffer({
  organizationId,
  organizationName,
  memberName,
  roleLabel,
  currentRoleLabel,
  state,
  onConfirm,
  onKind,
  onAmountDue,
}: SeatRoleOfferProps) {
  const offer = billingApi.subscription.seatOffer.useQuery({ organizationId });
  const utils = billingApi.useUtils();
  // The offer the admin pressed, so the done notice names what was bought, not the next seat.
  const [confirmed, setConfirmed] = useState<BuyableOffer | undefined>(undefined);
  const kind = offer.data?.kind;
  const amountDue = offer.data?.kind === "charge" ? offer.data.formattedAmountDue : undefined;

  useEffect(() => {
    if (kind !== undefined) onKind?.(kind);
  }, [kind, onKind]);
  // Once confirmed, the owner keeps the amount the admin pressed, whatever a refetch reprices.
  useEffect(() => {
    if (amountDue !== undefined && confirmed === undefined) onAmountDue?.(amountDue);
  }, [amountDue, confirmed, onAmountDue]);
  useEffect(() => {
    if (state === "done") void utils.subscription.invalidate();
  }, [state, utils]);

  if (state === "done") {
    return (
      <SeatAddedNotice
        confirmed={confirmed}
        organizationName={organizationName}
        memberName={memberName}
        roleLabel={roleLabel}
      />
    );
  }
  if (state === "stuck" || kind === "blocked") {
    return (
      <SeatHeldNotice
        organizationName={organizationName}
        memberName={memberName}
        currentRoleLabel={currentRoleLabel}
      />
    );
  }
  if (kind === "support") {
    return (
      <SeatSupportNotice
        organizationName={organizationName}
        memberName={memberName}
        currentRoleLabel={currentRoleLabel}
      />
    );
  }
  if (offer.isLoading) return <SkeletonRows rows={2} label="Pricing one more seat" />;
  if (offer.isError || offer.data === undefined) {
    return (
      <Alert.Root status="error" size="sm" role="alert">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>
            {describeError({ error: offer.error, fallbackTitle: "Couldn't price one more seat" })}
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }
  const buyable = offer.data;
  if (buyable.kind === "none") return null;
  return (
    <SeatOfferCard
      offer={buyable}
      memberName={memberName}
      roleLabel={roleLabel}
      busy={state === "busy"}
      onConfirm={() => {
        setConfirmed(buyable);
        if (buyable.kind === "charge") onAmountDue?.(buyable.formattedAmountDue);
        onConfirm(buyable.kind === "charge" ? buyable.quotedAt : undefined);
      }}
    />
  );
}
