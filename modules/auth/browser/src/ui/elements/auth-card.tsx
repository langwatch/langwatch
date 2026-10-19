import "../../model/ambient.d.ts";
import { BrandedCard } from "@langwatch/design-system/branded-card";

import "./auth-front-door.css";
import { VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/** The branded card for every auth screen; its hooks let the door animate the card. */
export function AuthCard({
  title,
  intro,
  finePrint,
  solid = false,
  actions,
  children,
}: {
  title: string;
  /** One quiet line answering the heading. Part of the identity block:
   *  centred and balanced with it, never a row of the form below. */
  intro?: string;
  /** The small print under everything: terms, privacy, nothing louder. */
  finePrint?: ReactNode;
  /** A near-solid floor instead of the glass, for a card that is one sentence with nothing
   *  to operate: the glass that flatters a column of fields washes a lone sentence out. */
  solid?: boolean;
  /** The ways out of the card: FrontDoorLinkButtons, stacked full width under the body. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <BrandedCard
      title={title}
      intro={intro}
      footer={finePrint}
      cardAttributes={{
        "data-auth-card": true,
        "data-auth-card-surface": solid ? "solid" : "glass",
      }}
      logoAttributes={{ "data-auth-card-logo": true }}
      bodyAttributes={{ "data-auth-card-body": true }}
    >
      {children}
      {actions ? (
        <VStack width="full" align="stretch" gap={3}>
          {actions}
        </VStack>
      ) : null}
    </BrandedCard>
  );
}
