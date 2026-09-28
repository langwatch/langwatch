import { Badge, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type {
  CliSessionCard,
  PersonalIngestionKeyListing,
} from "@langwatch/enterprise-governance-contract";
import { KeyRound, Laptop, Monitor, Server, Smartphone } from "lucide-react";
import type { ReactNode } from "react";

import { readableDate } from "../../model/display-formatters.ts";
import { formatRelativeTime } from "../../model/relative-time.ts";

/**
 * The shell every credential on the devices tab is drawn in: an icon, what it
 * is, when it was last used, the way to revoke it, and the rows it owns. A CLI
 * session and the group of session-less keys share it so they cannot drift.
 */
export function CredentialCard({
  icon,
  title,
  badge,
  subline,
  meta,
  action,
  confirmation,
  isPendingRevoke = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  subline?: string | null;
  meta?: ReactNode;
  action?: ReactNode;
  confirmation?: ReactNode;
  isPendingRevoke?: boolean;
  children?: ReactNode;
}) {
  return (
    <VStack
      align="stretch"
      gap={2}
      borderWidth="1px"
      borderColor={isPendingRevoke ? "red.emphasized" : "border.muted"}
      borderRadius="sm"
      padding={3}
      data-credential-card={title}
    >
      <HStack gap={3}>
        <Box>{icon}</Box>
        <VStack align="start" gap={0} flex={1}>
          <HStack gap={2}>
            <Text fontSize="sm" fontWeight="medium">
              {title}
            </Text>
            {badge}
          </HStack>
          {subline && (
            <Text fontSize="xs" color="fg.muted">
              {subline}
            </Text>
          )}
          {meta}
        </VStack>
        {action}
      </HStack>
      {confirmation}
      {children}
    </VStack>
  );
}

/** The red strip that asks a second time before a credential stops working. */
export function RevokeConfirmation({
  question,
  isRevoking,
  onCancel,
  onConfirm,
}: {
  question: string;
  isRevoking: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <HStack gap={2} paddingY={2} paddingX={3} backgroundColor="red.subtle" borderRadius="sm">
      <Text fontSize="xs" color="red.fg" flex={1}>
        {question}
      </Text>
      <Button size="xs" variant="ghost" onClick={onCancel} disabled={isRevoking}>
        Cancel
      </Button>
      <Button size="xs" colorPalette="red" onClick={onConfirm} loading={isRevoking}>
        Confirm revoke
      </Button>
    </HStack>
  );
}

/** One signed-in CLI device, holding the ingestion keys its session minted. */
export function DeviceCard({
  session,
  isPendingRevoke,
  isRevoking,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
  children,
}: {
  session: CliSessionCard;
  isPendingRevoke: boolean;
  isRevoking: boolean;
  onRequestRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  children?: ReactNode;
}) {
  const Icon = platformIcon(session.platform);
  const sub = [session.hostname, session.uname].filter(Boolean).join(" · ");

  return (
    <CredentialCard
      icon={<Icon size={20} />}
      title={session.deviceLabel}
      badge={
        session.platform ? (
          <Badge variant="surface" size="sm" colorPalette="gray">
            {session.platform}
          </Badge>
        ) : null
      }
      subline={sub || null}
      meta={
        <Text fontSize="xs" color="fg.muted">
          Last used {formatRelativeTime(session.lastSeenMs)} · Expires{" "}
          {fmtAbsolute(session.expiresAtMs)}
        </Text>
      }
      isPendingRevoke={isPendingRevoke}
      action={
        isPendingRevoke ? null : (
          <Button size="sm" variant="outline" colorPalette="red" onClick={onRequestRevoke}>
            Revoke
          </Button>
        )
      }
      confirmation={
        isPendingRevoke ? (
          <RevokeConfirmation
            question={`Revoke this device? The CLI on ${session.hostname ?? "this device"} will start failing immediately, and the ingestion keys it minted stop with it.`}
            isRevoking={isRevoking}
            onCancel={onCancelRevoke}
            onConfirm={onConfirmRevoke}
          />
        ) : null
      }
    >
      {children}
    </CredentialCard>
  );
}

/** The card for the ingestion keys no signed-in device is behind. */
export function OtherKeysCard({ children }: { children: ReactNode }) {
  return (
    <CredentialCard
      icon={<KeyRound size={20} />}
      title="Other keys"
      subline="Ingestion keys that no signed-in device is behind, minted from this page or by an agent."
    >
      {children}
    </CredentialCard>
  );
}

/**
 * One ingestion key, on the card of whatever it belongs to. A row rather than
 * a card of its own, because a key is something a device holds.
 */
export function IngestionKeyRow({
  ingestionKey,
  isPendingRevoke,
  isRevoking,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: {
  ingestionKey: PersonalIngestionKeyListing;
  isPendingRevoke: boolean;
  isRevoking: boolean;
  onRequestRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
}) {
  const holder = ingestionKey.deviceLabel ?? `key ${ingestionKey.apiKeyId.slice(-6)}`;
  return (
    <VStack
      align="stretch"
      gap={2}
      borderTopWidth="1px"
      borderColor="border.muted"
      paddingTop={2}
      data-ingestion-key={ingestionKey.sourceType}
    >
      <HStack gap={3}>
        <Box color="fg.muted">
          <KeyRound size={14} />
        </Box>
        <VStack align="start" gap={0} flex={1}>
          <Text fontSize="sm">Ingestion key · {ingestionKey.sourceType}</Text>
          <Text fontSize="xs" color="fg.muted">
            Last used {formatRelativeTime(ingestionKey.lastUsedAtMs)} · First issued{" "}
            {fmtDate(ingestionKey.createdAtMs)}
            {ingestionKey.deviceLabel ? ` · ${ingestionKey.deviceLabel}` : ""}
          </Text>
        </VStack>
        {!isPendingRevoke && (
          <Button
            size="xs"
            variant="ghost"
            colorPalette="red"
            aria-label={`Revoke the ${ingestionKey.sourceType} ingestion key on ${holder}`}
            onClick={onRequestRevoke}
          >
            Revoke
          </Button>
        )}
      </HStack>
      {isPendingRevoke && (
        <RevokeConfirmation
          question={`Revoke this ingestion key? Anything exporting ${ingestionKey.sourceType} traces with it stops immediately.`}
          isRevoking={isRevoking}
          onCancel={onCancelRevoke}
          onConfirm={onConfirmRevoke}
        />
      )}
    </VStack>
  );
}

const fmtAbsolute = (ms: number): string => (ms ? readableDate(ms).toLocaleString() : "—");

const fmtDate = (ms: number): string =>
  ms
    ? readableDate(ms).toLocaleDateString(void 0, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

const platformIcon = (platform: string | null) => {
  if (!platform) return Server;
  const p = platform.toLowerCase();
  if (p.includes("darwin") || p.includes("mac")) return Laptop;
  if (p.includes("linux")) return Monitor;
  if (p.includes("win")) return Laptop;
  if (p.includes("ios") || p.includes("android")) return Smartphone;
  return Server;
};
