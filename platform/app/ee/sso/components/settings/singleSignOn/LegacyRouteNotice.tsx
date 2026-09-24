import { Alert } from "@chakra-ui/react";
import { providerDisplayName } from "@ee/sso/logic/providerDisplayName";
import type { SelfServeSetupView } from "@ee/sso/sso-self-serve.types";
import { SettingList, SettingRow } from "~/components/settings/kit/SettingRow";

/**
 * What an organization sees when it already signs in through a provider that
 * predates connections.
 *
 * IT USED TO SEE THE VENDOR PICKER. `connection: null` meant both "nobody has
 * set this up" and "this was set up years ago and is routing people right
 * now", and the screen could only read the first — so it invited an
 * administrator to connect an identity provider on a domain their existing
 * route already answers. Following that built a SECOND connection beside the
 * live one, with nothing linking the two: no predecessor, no inherited proof
 * of the domain, and no way back.
 *
 * Moving the old route onto a connection is something LangWatch does, not
 * something the customer drives, so this screen's whole job is to say the
 * setup exists and stop offering to build a rival to it. Once the move has
 * happened the organization has a connection and gets the migration screen
 * instead, which is the one that does offer a replacement — safely, because
 * by then there is a predecessor to name.
 */
export function LegacyRouteNotice({
  legacyRoute,
}: {
  legacyRoute: NonNullable<SelfServeSetupView["legacyRoute"]>;
}) {
  const provider = providerDisplayName(legacyRoute.provider);
  return (
    <Alert.Root status="info" data-testid="sso-legacy-route">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Single sign-on is already set up</Alert.Title>
        <Alert.Description>
          Everyone with an address at this domain already signs in through your
          identity provider, so there is nothing to set up here. Get in touch if
          you want to change how your organization signs in.
        </Alert.Description>
        <SettingList>
          <SettingRow label="Domain">{legacyRoute.domain}</SettingRow>
          {/* Only when we can spell it. The stored value is an identifier,
              and a row reading "Identity provider: auth0" shows the customer
              our database rather than their provider. */}
          {provider && (
            <SettingRow label="Identity provider">{provider}</SettingRow>
          )}
        </SettingList>
      </Alert.Content>
    </Alert.Root>
  );
}
