import "../../model/ambient.d.ts";
import { BrandedCard } from "@langwatch/design-system/branded-card";

import "./auth-front-door.css";
import type { ReactNode } from "react";

/** The branded card for every auth screen; its hooks let the door animate the card. */
export function AuthCard({
  title,
  intro,
  finePrint,
  children,
}: {
  title: string;
  /** One quiet line answering the heading. Part of the identity block:
   *  centred and balanced with it, never a row of the form below. */
  intro?: string;
  /** The small print under everything: terms, privacy, nothing louder. */
  finePrint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <BrandedCard
      title={title}
      intro={intro}
      footer={finePrint}
      cardAttributes={{ "data-auth-card": true }}
      logoAttributes={{ "data-auth-card-logo": true }}
      bodyAttributes={{ "data-auth-card-body": true }}
    >
      {children}
    </BrandedCard>
  );
}
