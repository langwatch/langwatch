/**
 * The license card, over one read. Renamed from `LicenseStatus`, which is
 * already the CONTRACT's name for the payload this component renders —
 * sharing a name between component and payload type invited confusion.
 */

import { VStack } from "@langwatch/design-system/primitives";
import {
  type ConnectStatus,
  detectLicenseInputForm,
} from "@langwatch/enterprise-licensing-contract";
import { nowInstant } from "@langwatch/time";
import { useState } from "react";

import { connectApi } from "../../behavior/connect-api.ts";
import { licensingApi } from "../../behavior/licensing-api.ts";
import { isRevokedByLangWatch, syncLineOf } from "../../model/connect-sync.ts";
import { isConnectedLicense, licenseMetersSeats } from "../../model/license-status.ts";
import { type LicensingHostApi, useLicensingHost } from "../../model/licensing-host.ts";
import {
  type LicenseHostedState,
  LicenseDetailsCard,
} from "../../ui/elements/license-details-card.tsx";
import { LicenseLoadError } from "../../ui/elements/license-load-error.tsx";
import { LicenseLoadingSkeleton } from "../../ui/elements/license-loading-skeleton.tsx";
import { OverSeatsCallout } from "../../ui/elements/over-seats-callout.tsx";
import { NoLicenseCard } from "./no-license-card.tsx";
import { useLicenseActions } from "./use-license-actions.ts";

/** A signed license key is a base64 blob of a few hundred characters. */
const MIN_LICENSE_KEY_LENGTH = 64;

interface LicenseStatusPanelProps {
  organizationId: string;
}

export function LicenseStatusPanel({ organizationId }: LicenseStatusPanelProps) {
  const [licenseKey, setLicenseKey] = useState("");
  const [isReplacing, setIsReplacing] = useState(false);
  const host = useLicensingHost();
  // The server refuses every change without organization:manage; this only hides what would fail.
  const canManage = host.canManageOrganization();

  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = licensingApi.license.getStatus.useQuery(
    { organizationId },
    {
      enabled: !!organizationId,
      refetchOnWindowFocus: false,
      staleTime: 30_000, // Consider fresh for 30 seconds
    },
  );

  // The sync line and a revocation are read from Connect, the same reading its page shows.
  const isConnected = !!status?.hasLicense && isConnectedLicense(status);
  // A refresh waits for its outcome until the line moves or the deadline passes, with no timer.
  const [awaitedSync, setAwaitedSync] = useState<{ from: string; until: number } | null>(null);
  const connectStatus = connectApi.connect.status.useQuery(
    { organizationId },
    {
      enabled: isConnected,
      refetchOnWindowFocus: false,
      refetchInterval: () =>
        awaitedSync !== null && nowInstant().epochMilliseconds < awaitedSync.until
          ? SYNC_RECORD_POLL_MS
          : false,
    },
  );
  const recordedSync = syncKeyOf(connectStatus.data);
  if (awaitedSync !== null && recordedSync !== awaitedSync.from) setAwaitedSync(null);

  const [activationCode, setActivationCode] = useState("");
  const { upload, activate, remove, refresh, isUploading, isRemoving, isRefreshing } =
    useLicenseActions({
      organizationId,
      onUploadSuccess: () => {
        setLicenseKey("");
        setActivationCode("");
        setIsReplacing(false);
        void refetch();
      },
      onRemoveSuccess: () => {
        void refetch();
      },
      onRefreshSettled: () => {
        if (!isConnected) return;
        // The sync outcome is recorded by a subscriber, so it lands a moment after the refresh.
        setAwaitedSync({
          from: recordedSync,
          until: nowInstant().epochMilliseconds + SYNC_RECORD_WAIT_MS,
        });
      },
    });

  // Every field accepts both forms, the same as LANGWATCH_LICENSE_KEY: the
  // value's shape decides whether it is redeemed as a code or stored as a key.
  const submitLicense = (text: string) => {
    const input = detectLicenseInputForm(text);
    if (input.form === "activation_code") activate(input.code);
    else if (input.form === "license_key") upload(input.licenseKey);
  };

  // A short value that is not a code is a mistyped code, not a license key:
  // redeeming it gets the "malformed code" answer, not a license format error.
  const handleCodeActivate = () => {
    const typed = activationCode.trim();
    if (
      detectLicenseInputForm(typed).form === "license_key" &&
      typed.length < MIN_LICENSE_KEY_LENGTH
    ) {
      activate(typed);
      return;
    }
    submitLicense(activationCode);
  };

  if (isLoading) {
    return <LicenseLoadingSkeleton />;
  }

  if (isError) {
    return <LicenseLoadError onRetry={() => void refetch()} />;
  }

  if (!status?.hasLicense) {
    return (
      <VStack align="start" gap={6} width="full">
        <NoLicenseCard
          licenseKey={licenseKey}
          onLicenseKeyChange={setLicenseKey}
          onActivate={() => submitLicense(licenseKey)}
          onFileActivate={submitLicense}
          activationCode={activationCode}
          onActivationCodeChange={setActivationCode}
          onCodeActivate={handleCodeActivate}
          isActivating={isUploading}
          canManage={canManage}
        />
      </VStack>
    );
  }

  return (
    <VStack align="start" gap={6} width="full">
      {licenseMetersSeats(status) && (
        <OverSeatsCallout currentMembers={status.currentMembers} maxMembers={status.maxMembers} />
      )}
      <LicenseDetailsCard
        status={status}
        onRemove={remove}
        isRemoving={isRemoving}
        onRefresh={refresh}
        isRefreshing={isRefreshing}
        onReplace={() => setIsReplacing(true)}
        canManage={canManage}
        hosted={hostedStateOf({ host, status: connectStatus.data })}
      />
      {isReplacing && canManage ? (
        <NoLicenseCard
          mode="replace"
          onCancel={() => setIsReplacing(false)}
          licenseKey={licenseKey}
          onLicenseKeyChange={setLicenseKey}
          onActivate={() => submitLicense(licenseKey)}
          onFileActivate={submitLicense}
          activationCode={activationCode}
          onActivationCodeChange={setActivationCode}
          onCodeActivate={handleCodeActivate}
          isActivating={isUploading}
          canManage={canManage}
        />
      ) : null}
    </VStack>
  );
}

/** The Connect reading in the card's words; absent until it is read or where Connect is off. */
function hostedStateOf({
  host,
  status,
}: {
  host: LicensingHostApi;
  status: ConnectStatus | undefined;
}): LicenseHostedState | undefined {
  if (status?.deployment !== "on") return void 0;
  const line = syncLineOf(status.sync);
  return {
    syncText: line.text,
    ...(status.sync.lastError
      ? {
          syncFailure: host.describeFailure({
            error: { error: { code: status.sync.lastError.code } },
            fallbackTitle: "The last license sync did not complete",
          }),
        }
      : {}),
    isRevoked: isRevokedByLangWatch(status),
  };
}

/** How often, and for how long, the panel re-reads Connect for the sync a refresh recorded. */
const SYNC_RECORD_POLL_MS = 1_000;
const SYNC_RECORD_WAIT_MS = 10_000;

/** What the last sync recorded, to tell when a newer outcome arrived. */
function syncKeyOf(status: ConnectStatus | undefined): string {
  if (!status || status.deployment !== "on") return "";
  return `${status.sync.lastSyncAt ?? ""}|${status.sync.lastError?.code ?? ""}`;
}
