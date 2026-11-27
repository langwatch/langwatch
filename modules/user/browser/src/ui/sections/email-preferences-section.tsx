/**
 * Email preferences: the weekly digest, on or off for you across every organization you are in.
 * The one-click unsubscribe in the email writes the same choice, so the two always agree.
 * Spec: enterprise/modules/digest/specs/digest.feature
 */

import { Button, HStack, Skeleton, Text } from "@langwatch/design-system/primitives";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Switch } from "@langwatch/design-system/switch";
import { ToggleRow } from "@langwatch/design-system/toggle-row";
import { Mail } from "lucide-react";
import { useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";

/**
 * What the weekly digest's footer link scrolls to (`/settings/profile#email-preferences`, built
 * by digest's `DIGEST_EMAIL_PREFERENCES_PATH`); the digest module cannot be imported here.
 */
const EMAIL_PREFERENCES_ANCHOR = "email-preferences";

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
