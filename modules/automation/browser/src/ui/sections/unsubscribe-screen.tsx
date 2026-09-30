/**
 * The unsubscribe landing (public, no auth guard; ADR-031). Token passed as
 * prop for authorization; offers two unsubscribe scopes: this notification or
 * entire project. Spec: specs/automations/unsubscribe-landing.feature
 */

import { Button, Center, Spinner } from "@chakra-ui/react";
import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import { useState } from "react";

import { automationApi } from "../../behavior/automation-api.ts";

/** Which of the two promises in the footer link the recipient took. */
export type UnsubscribeScope = "trigger" | "project";

export default function UnsubscribeScreen({ token }: { token: string }) {
  const [done, setDone] = useState<UnsubscribeScope | null>(null);

  const resolved = automationApi.emailSuppression.resolveUnsubscribeToken.useQuery(
    { token },
    { enabled: !!token, retry: false },
  );
  const confirm = automationApi.emailSuppression.confirmUnsubscribe.useMutation();

  const onConfirm = (scope: UnsubscribeScope) => {
    confirm.mutate({ token, scope }, { onSuccess: () => setDone(scope) });
  };

  function renderUnsubscribeCard() {
    if (!token || resolved.isError) {
      return (
        <BrandedCard
          title="Link not valid"
          intro="This unsubscribe link is invalid or has expired."
        />
      );
    }
    if (resolved.isLoading || !resolved.data) {
      return (
        <BrandedCard title="Unsubscribe">
          <Center>
            <Spinner data-testid="unsubscribe-loading" />
          </Center>
        </BrandedCard>
      );
    }
    if (done) {
      return (
        <BrandedCard
          title="You're unsubscribed"
          intro={
            done === "project"
              ? `${resolved.data.email} will no longer receive notifications from ${resolved.data.projectName}.`
              : `${resolved.data.email} will no longer receive ${
                  resolved.data.triggerName ?? "this notification"
                }.`
          }
        />
      );
    }
    return (
      <BrandedCard
        title="Unsubscribe"
        intro={`Choose how ${resolved.data.email} should stop receiving email from ${resolved.data.projectName}.`}
      >
        {resolved.data.triggerName && (
          <Button
            variant="outline"
            loading={confirm.isPending}
            onClick={() => onConfirm("trigger")}
          >
            Stop receiving {resolved.data.triggerName}
          </Button>
        )}
        <Button colorPalette="red" loading={confirm.isPending} onClick={() => onConfirm("project")}>
          Stop all notifications from {resolved.data.projectName}
        </Button>
      </BrandedCard>
    );
  }

  return <BrandedCardPage>{renderUnsubscribeCard()}</BrandedCardPage>;
}
