// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A SAML connection's opt-in to sign-ins its identity provider starts, and
 * the app paths such a sign-in may land on.
 * Spec: specs/identity/sso-saml-idp-initiated.feature.
 */
import {
  Button,
  Field,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";
import { X } from "lucide-react";
import { useState } from "react";

import { canListLandingTarget, type SamlIdpInitiated } from "../../model/registration-form.ts";

const MAX_LANDING_TARGETS = 20;

export function IdpInitiatedFields({
  value,
  onChange,
}: {
  value: SamlIdpInitiated;
  onChange: (value: SamlIdpInitiated) => void;
}) {
  const [draft, setDraft] = useState("");
  const [refused, setRefused] = useState(false);
  const full = value.landingTargets.length >= MAX_LANDING_TARGETS;

  const add = () => {
    const target = draft.trim();
    if (!canListLandingTarget({ listed: value.landingTargets, target })) {
      setRefused(true);
      return;
    }
    onChange({ ...value, landingTargets: [...value.landingTargets, target] });
    setDraft("");
    setRefused(false);
  };

  return (
    <VStack align="stretch" gap={2}>
      <Switch
        size="sm"
        checked={value.enabled}
        onCheckedChange={({ checked }) => onChange({ ...value, enabled: checked })}
        inputProps={{ "data-testid": "sso-idp-initiated" }}
      >
        Allow sign-in started from your identity provider
      </Switch>
      <Text color="fg.muted" fontSize="sm">
        People can sign in from your identity provider's dashboard and land on one of the pages you
        list here, or on their home page.
      </Text>
      {value.enabled && (
        <>
          {value.landingTargets.map((target) => (
            <HStack key={target} gap={2} data-testid="sso-landing-target">
              <Text fontSize="sm" fontFamily="mono" flex={1}>
                {target}
              </Text>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={`Remove ${target}`}
                onClick={() =>
                  onChange({
                    ...value,
                    landingTargets: value.landingTargets.filter((listed) => listed !== target),
                  })
                }
              >
                <X />
              </IconButton>
            </HStack>
          ))}
          <Field.Root invalid={refused}>
            <Field.Label>Landing page</Field.Label>
            <HStack gap={2}>
              <Input
                placeholder="/acme/messages"
                value={draft}
                disabled={full}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setRefused(false);
                }}
              />
              <Button size="sm" variant="outline" onClick={add} disabled={full || draft === ""}>
                Add
              </Button>
            </HStack>
            {refused ? (
              <Field.ErrorText>
                A landing page must be a path on LangWatch itself, such as /acme/messages, listed
                once.
              </Field.ErrorText>
            ) : (
              full && (
                <Field.HelperText>You can list up to {MAX_LANDING_TARGETS} pages.</Field.HelperText>
              )
            )}
          </Field.Root>
        </>
      )}
    </VStack>
  );
}
