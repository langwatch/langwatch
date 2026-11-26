/**
 * Email preferences: the weekly digest, on or off for you across every organization you are in.
 * The one-click unsubscribe in the email writes the same choice, so the two always agree.
 * Spec: enterprise/modules/digest/specs/digest.feature
 */

import { Skeleton } from "@langwatch/design-system/primitives";
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
export const EMAIL_PREFERENCES_ANCHOR = "email-preferences";

export function EmailPreferencesSection() {
  const host = usePersonalWorkspaceHost();
  const preference = api.digest.getMyPreference.useQuery({});
  const setPreference = api.digest.setMyPreference.useMutation();
  const utils = api.useUtils();
  // What the person just chose, shown until the stored choice is read back: a failed save
  // returns the switch to what is stored.
  const [chosen, setChosen] = useState<boolean | null>(null);

  const change = async (subscribed: boolean) => {
    setChosen(subscribed);
    try {
      await setPreference.mutateAsync({ subscribed });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't save your email preference" });
    }
    await utils.digest.getMyPreference.invalidate();
    setChosen(null);
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
        <Skeleton height="48px" borderRadius="md" />
      ) : (
        <ToggleRow
          label="Weekly digest"
          hint="One email a week for each organization you are in, about that organization's week. Turning it off stops all of them."
          on={chosen ?? preference.data.subscribed}
        >
          <Switch
            checked={chosen ?? preference.data.subscribed}
            disabled={chosen !== null}
            onCheckedChange={({ checked }) => void change(checked)}
            inputProps={{ "aria-label": "Weekly digest", "data-testid": "weekly-digest-switch" }}
          />
        </ToggleRow>
      )}
    </SettingsSection>
  );
}
