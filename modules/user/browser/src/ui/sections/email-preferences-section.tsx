/**
 * Email preferences: the weekly digest, on or off for you across every organization you are in;
 * the email's one-click unsubscribe writes the same choice. Staff holding ops:manage can also
 * send themselves this week's digests, marked [Test]. Spec: digest/specs/digest.feature
 */

import { Badge, Button, HStack, Skeleton, Stack, Text } from "@langwatch/design-system/primitives";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Switch } from "@langwatch/design-system/switch";
import { ToggleRow } from "@langwatch/design-system/toggle-row";
import type { DigestMyTest, DigestTemplateId } from "@langwatch/enterprise-digest-contract";
import { Mail } from "lucide-react";
import { useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";

/**
 * What the weekly digest's footer link scrolls to (`/settings/profile#email-preferences`, built
 * by digest's `DIGEST_EMAIL_PREFERENCES_PATH`); the digest module cannot be imported here.
 */
const EMAIL_PREFERENCES_ANCHOR = "email-preferences";

/** The staff grant digest's door asks for the test sends; the button shows only to holders. */
const OPS_MANAGE_PERMISSION = "ops:manage";

const TEMPLATE_LABELS: Record<DigestTemplateId, string> = {
  "digest-plan-pressure": "Plan usage",
  "digest-scenarios-trend": "Scenarios trend",
  "digest-coding-agent-week": "Coding-agent week",
  "digest-traces-week": "Traces week",
  "digest-whats-new": "What's new",
};

const SKIP_LABELS: Record<Extract<DigestMyTest, { outcome: "skipped" }>["reason"], string> = {
  nothing_to_send: "Skipped: nothing to show you this week",
  opted_out: "Skipped: you turned the weekly digest off",
  not_a_member: "Skipped: you are no longer a member",
};

export function EmailPreferencesSection() {
  const host = usePersonalWorkspaceHost();
  const preference = api.digest.getMyPreference.useQuery({});
  const setPreference = api.digest.setMyPreference.useMutation();
  const utils = api.useUtils();
  // What the person just chose, shown until the stored choice is read back successfully, so a
  // failed read-back never flips the switch to a stale value; a failed save returns it to
  // what is stored.
  const [chosen, setChosen] = useState<boolean | null>(null);

  const change = async (subscribed: boolean) => {
    setChosen(subscribed);
    try {
      await setPreference.mutateAsync({ subscribed });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't save your email preference" });
      setChosen(null);
      return;
    }
    try {
      // `invalidate` swallows a failed refetch; `fetch` rejects, so the choice stays shown.
      await utils.digest.getMyPreference.fetch({}, { staleTime: 0 });
      setChosen(null);
    } catch {
      // The save went through; the next successful read corrects the display.
    }
  };

  return (
    <SettingsSection
      anchorId={EMAIL_PREFERENCES_ANCHOR}
      icon={<Mail size={18} />}
      title="Email preferences"
      hint="Which emails LangWatch sends you."
      data-testid="email-preferences-settings-section"
    >
      {preference.data === undefined ? (
        <PreferencePending failed={preference.isError} onRetry={() => void preference.refetch()} />
      ) : (
        <ToggleRow
          label="Weekly digest"
          hint="One email a week for each organization you are in, about that organization's week. Turning it off stops all of them."
          on={chosen ?? preference.data.subscribed}
        >
          <Switch
            checked={chosen ?? preference.data.subscribed}
            disabled={setPreference.isPending}
            onCheckedChange={({ checked }) => void change(checked)}
            inputProps={{ "aria-label": "Weekly digest", "data-testid": "weekly-digest-switch" }}
          />
        </ToggleRow>
      )}
      {host.hasPermission(OPS_MANAGE_PERMISSION) ? <SendMyDigests /> : null}
    </SettingsSection>
  );
}

/** A skeleton while the choice loads; an inline retry when it could not be read. */
function PreferencePending({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (!failed) return <Skeleton height="48px" borderRadius="md" />;
  return (
    <HStack justify="space-between" gap={3}>
      <Text textStyle="sm">Couldn't load your email preference.</Text>
      <Button size="xs" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </HStack>
  );
}

/** Staff only: this week's digest for each of your organizations, mailed to you as a test. */
function SendMyDigests() {
  const host = usePersonalWorkspaceHost();
  const send = api.digest.sendMyTests.useMutation();

  const press = async () => {
    try {
      await send.mutateAsync({});
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't send your digests" });
    }
  };

  return (
    <Stack gap={2} data-testid="send-my-digests">
      <ToggleRow
        label={
          <HStack gap={2}>
            <span>Send me my digests</span>
            <Badge size="sm">Staff</Badge>
          </HStack>
        }
        hint="Emails you this week's digest for each organization you are in, as you would get it, marked [Test]."
      >
        <Button
          size="xs"
          variant="outline"
          loading={send.isPending}
          onClick={() => void press()}
          data-testid="send-my-digests-button"
        >
          Send me my digests
        </Button>
      </ToggleRow>
      {send.data ? <MyDigestResults organizations={send.data.organizations} /> : null}
    </Stack>
  );
}

function MyDigestResults({ organizations }: { organizations: readonly DigestMyTest[] }) {
  if (organizations.length === 0) {
    return <Text textStyle="sm">You are not an active member of any organization.</Text>;
  }
  return (
    <Stack as="ul" gap={1} listStyleType="none" data-testid="send-my-digests-results">
      {organizations.map((organization) => (
        <HStack as="li" key={organization.organizationId} justify="space-between" gap={3}>
          <Text textStyle="sm">{organization.organizationName}</Text>
          <Text textStyle="sm" color={organization.outcome === "failed" ? "fg.error" : "fg.muted"}>
            {outcomeLabel(organization)}
          </Text>
        </HStack>
      ))}
    </Stack>
  );
}

function outcomeLabel(organization: DigestMyTest): string {
  if (organization.outcome === "sent") {
    return `Sent: ${TEMPLATE_LABELS[organization.templateId]}`;
  }
  if (organization.outcome === "skipped") return SKIP_LABELS[organization.reason];
  return "Failed: couldn't be sent";
}
