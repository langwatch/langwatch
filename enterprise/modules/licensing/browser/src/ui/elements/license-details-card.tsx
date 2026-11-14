import { Banner } from "@langwatch/design-system/banner";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Button, HStack, Link, Text } from "@langwatch/design-system/primitives";
import {
  OverviewCard,
  OverviewDetail,
  type OverviewChip,
} from "@langwatch/design-system/settings-card";
import { StatTile, StatTileFigure, StatTileGrid } from "@langwatch/design-system/stat-tile";
import type { LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";
import { Building2, CalendarClock, Layers, UserRound, Users } from "lucide-react";
import { useState } from "react";

import {
  cappedLiteSeatsOf,
  formatLicenseDate,
  formatLicenseDateShort,
  formatLimitOrUnlimited,
  hasLicenseMetadata,
  isCappedLimit,
  isCorruptedLicense,
  isConnectedLicense,
  isEnvironmentLicense,
  isLicenseExpired,
} from "../../model/license-status.ts";

interface LicenseDetailsCardProps {
  status: Extract<LicenseStatus, { hasLicense: true }>;
  onRemove: () => void;
  isRemoving: boolean;
  /** Syncs the license with LangWatch now. Offered on a connected license, expired or not. */
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Opens the form that enters a new license over this one. */
  onReplace?: () => void;
  /** Whether the viewer may manage the organization; without it no action is offered. */
  canManage: boolean;
  /** Where hosted services stand for a connected license, from Connect; absent while unread. */
  hosted?: LicenseHostedState;
}

/** What the Connect status says about a connected license, in the card's words. */
export interface LicenseHostedState {
  /** "Last synced 5 minutes ago", "Not synced yet", or led by the last failure. */
  syncText: string;
  /** Why the last sync failed, when it did. */
  syncFailure?: string;
  /** LangWatch revoked the license, so hosted services are off. */
  isRevoked: boolean;
}

const REVOKED_SENTENCE = "Revoked by LangWatch: hosted services are off";

/**
 * Where the license stands, in one word. A lapsed license is a warning rather
 * than a breakage: it still meters the seats it sold and every capability keeps
 * working, so it asks for attention.
 */
function licenseChipOf({
  isValid,
  isExpired,
  isRevoked,
}: {
  isValid: boolean;
  isExpired: boolean;
  isRevoked: boolean;
}): OverviewChip {
  if (isRevoked) return { label: "Revoked", tone: "bad", title: REVOKED_SENTENCE };
  if (isValid) return { label: "Valid", tone: "good", title: "The signature checks out" };
  if (isExpired) return { label: "Expired", tone: "warning", title: "The term has ended" };
  return { label: "Invalid", tone: "bad", title: "The signature does not check out" };
}

function statusSentenceOf({
  isValid,
  isExpired,
  isRevoked,
}: {
  isValid: boolean;
  isExpired: boolean;
  isRevoked: boolean;
}) {
  if (isRevoked) return REVOKED_SENTENCE;
  if (isValid) return "Valid, the signature checks out";
  if (isExpired) return "Term ended, the signature checks out";
  return "The signature does not check out";
}

/**
 * What a lapse actually changed, which is almost nothing. Naming the seat count
 * here is the point: it is the number that keeps binding, and the only thing
 * renewal buys back is room above it.
 */
function LapsedLicenseNotice({ maxMembers }: { maxMembers: number }) {
  return (
    <Banner status="warning">
      Your license reached its end date. Nothing was switched off: everyone keeps their access and
      your {maxMembers} {maxMembers === 1 ? "seat" : "seats"} and enterprise capabilities stay as
      they are. Renew to add members again.
    </Banner>
  );
}

/** A license whose signature does not check out. Its numbers mean nothing. */
function InvalidLicenseNotice() {
  return (
    <Banner status="error">
      Your license is invalid. Please contact support or upload a valid license.
    </Banner>
  );
}

function ContactSalesButton() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={CONTACT_SALES_URL} target="_blank">
        Contact sales
      </Link>
    </Button>
  );
}

/** Removing drops the organization to the open source plan, so it asks first. */
function RemoveLicenseButton({
  onRemove,
  isRemoving,
}: {
  onRemove: () => void;
  isRemoving: boolean;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        colorPalette="red"
        onClick={() => setIsConfirming(true)}
        data-testid="license-remove"
        loading={isRemoving}
        disabled={isRemoving}
      >
        Remove license
      </Button>
      <ConfirmDialog
        open={isConfirming}
        onClose={() => setIsConfirming(false)}
        title="Remove the license?"
        description="The organization returns to the open source plan at once. It loses the seats this license covers and its enterprise capabilities, such as single sign-on, SCIM provisioning and audit logs. An activation code works once, so activating again later needs a new code from LangWatch. To renew, replace the license instead."
        confirmLabel="Remove license"
        tone="danger"
        loading={isRemoving}
        onConfirm={() => {
          setIsConfirming(false);
          onRemove();
        }}
      />
    </>
  );
}

function ReplaceLicenseButton({ onReplace }: { onReplace: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onReplace} data-testid="license-replace">
      Replace license
    </Button>
  );
}

export function LicenseDetailsCard({
  status,
  onRemove,
  isRemoving,
  onRefresh,
  isRefreshing = false,
  onReplace,
  canManage,
  hosted,
}: LicenseDetailsCardProps) {
  const isValid = status.valid;
  const isRevoked = hosted?.isRevoked ?? false;
  const isExpired = isLicenseExpired(status);
  const isConnected = isConnectedLicense(status);
  const isFromEnvironment = isEnvironmentLicense(status);
  const canRefresh = canManage && isConnected && onRefresh !== void 0;
  const canRemove = canManage && !isFromEnvironment;
  const canReplace = canManage && onReplace !== void 0;

  if (isCorruptedLicense(status)) {
    return (
      <>
        <Banner status="error">
          Your license file is corrupted and cannot be read. Please upload a valid license or
          contact support.
        </Banner>
        <OverviewCard
          title="License"
          chip={{ label: "Corrupted", tone: "bad", title: "The license file cannot be read" }}
          actions={
            <>
              {canReplace && onReplace ? <ReplaceLicenseButton onReplace={onReplace} /> : null}
              {canManage ? (
                <RemoveLicenseButton onRemove={onRemove} isRemoving={isRemoving} />
              ) : null}
              <ContactSalesButton />
            </>
          }
        >
          <OverviewDetail label="Status">The file cannot be read</OverviewDetail>
        </OverviewCard>
      </>
    );
  }

  if (!hasLicenseMetadata(status)) {
    return null;
  }

  const seatsAreCapped = isCappedLimit(status.maxMembers);
  const liteSeats = cappedLiteSeatsOf(status);

  return (
    <>
      {isExpired && <LapsedLicenseNotice maxMembers={status.maxMembers} />}
      {!isValid && !isExpired && <InvalidLicenseNotice />}
      {/* Four across even with a Lite seats tile: a fifth wraps, so no figure is cut short. */}
      <StatTileGrid columns={4}>
        <StatTile label="Plan" icon={<Layers size={14} />} data-testid="license-plan">
          <StatTileFigure>{status.planName}</StatTileFigure>
        </StatTile>
        <StatTile
          data-testid="license-seats"
          label="Seats"
          icon={<Users size={14} />}
          meter={
            seatsAreCapped ? { current: status.currentMembers, max: status.maxMembers } : void 0
          }
        >
          <StatTileFigure>
            {status.currentMembers.toLocaleString()} / {formatLimitOrUnlimited(status.maxMembers)}
          </StatTileFigure>
        </StatTile>
        {liteSeats ? (
          <StatTile
            data-testid="license-lite-seats"
            label="Lite seats"
            icon={<UserRound size={14} />}
            meter={liteSeats}
          >
            <StatTileFigure>
              {liteSeats.current.toLocaleString()} / {liteSeats.max.toLocaleString()}
            </StatTileFigure>
          </StatTile>
        ) : null}
        <StatTile label="Expires" icon={<CalendarClock size={14} />} data-testid="license-expires">
          <StatTileFigure title={formatLicenseDate(status.expiresAt)}>
            <Text as="span" color={isExpired ? "orange.fg" : void 0}>
              {formatLicenseDateShort(status.expiresAt)}
            </Text>
          </StatTileFigure>
        </StatTile>
        <StatTile label="Licensed to" icon={<Building2 size={14} />} data-testid="license-holder">
          <StatTileFigure title={status.organizationName}>{status.organizationName}</StatTileFigure>
        </StatTile>
      </StatTileGrid>
      <OverviewCard
        title="License"
        chip={licenseChipOf({ isValid, isExpired, isRevoked })}
        actions={
          <HStack gap={2} flexWrap="wrap">
            {canRefresh ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                loading={isRefreshing}
                disabled={isRefreshing}
                data-testid="refresh-license"
              >
                Refresh license
              </Button>
            ) : null}
            {canReplace && onReplace ? <ReplaceLicenseButton onReplace={onReplace} /> : null}
            {canRemove ? <RemoveLicenseButton onRemove={onRemove} isRemoving={isRemoving} /> : null}
          </HStack>
        }
      >
        <OverviewDetail label="Status">
          <span data-testid="license-status-sentence">
            {statusSentenceOf({ isValid, isExpired, isRevoked })}
          </span>
        </OverviewDetail>
        {isFromEnvironment ? (
          <OverviewDetail label="Source">
            Installed from the environment (LANGWATCH_LICENSE_KEY)
          </OverviewDetail>
        ) : null}
        {isConnected && hosted ? (
          <SyncDetail hosted={hosted} isAwaitingRenewal={!isValid && !isRevoked} />
        ) : null}
      </OverviewCard>
    </>
  );
}

/** When the license last synced, why the last sync failed, and whether a renewal waits. */
function SyncDetail({
  hosted,
  isAwaitingRenewal,
}: {
  hosted: LicenseHostedState;
  isAwaitingRenewal: boolean;
}) {
  return (
    <OverviewDetail label="Sync">
      <Text as="span" data-testid="license-sync-line">
        {hosted.syncText}
      </Text>
      {isAwaitingRenewal ? (
        <Text fontSize="sm" color="fg.muted">
          Refresh to collect a renewal.
        </Text>
      ) : null}
      {hosted.syncFailure ? (
        <Text fontSize="sm" color="fg.muted" data-testid="license-sync-failure">
          {hosted.syncFailure}
        </Text>
      ) : null}
    </OverviewDetail>
  );
}
