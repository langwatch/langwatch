import "../../model/ambient.d.ts";
import { BrandedCard } from "@langwatch/design-system/branded-card";

import "./auth-front-door.css";
import type { ReactNode } from "react";

/** Glass card container for all auth screens; centered on desktop, full-bleed on mobile. */
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
      className="lw-front-door-card"
      cardAttributes={{ "data-auth-card": true }}
      logoAttributes={{ "data-auth-card-logo": true }}
      bodyAttributes={{ "data-auth-card-body": true }}
    >
      {children}
    </BrandedCard>
  );
}
