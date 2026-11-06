/**
 * Seats in use against the plan, with the way to change who holds them.
 * @see specs/licensing/usage-page.feature
 */
import { Link } from "@langwatch/browser-host/link";
import { Card } from "@langwatch/design-system/card";
import { HStack, Text } from "@langwatch/design-system/primitives";
import { SettingList, SettingRow } from "@langwatch/design-system/settings-card";
import { ArrowRight } from "lucide-react";

import type { LiteRow } from "../../model/usage-page-state.ts";

export const USERS_HREF = "/settings/members";

function Value({ children }: { children: string }) {
  return (
    <Text textStyle="bodySm" fontWeight={600} fontVariantNumeric="tabular-nums">
      {children}
    </Text>
  );
}

export function UsageSeatsCard({ fullSeats, lite }: { fullSeats: string; lite: LiteRow }) {
  return (
    <Card
      data-testid="usage-seats-card"
      title="Seats"
      actions={
        <Link href={USERS_HREF} textStyle="bodySm" data-testid="usage-manage-users">
          <HStack as="span" gap={1}>
            Manage in Users <ArrowRight size={14} aria-hidden />
          </HStack>
        </Link>
      }
    >
      <SettingList variant="boxed">
        <SettingRow label="Full seats" data-testid="usage-full-seats">
          <Value>{fullSeats}</Value>
        </SettingRow>
        {lite.kind !== "none" && (
          <SettingRow label="Lite members" data-testid="usage-lite-members">
            {lite.kind === "on-growth" ? (
              <Text textStyle="bodySm" color="fg.muted">
                Lite members come with Growth, read only, free and unlimited.
              </Text>
            ) : (
              <>
                <Value>{lite.value}</Value>
                {lite.note && (
                  <Text textStyle="bodySm" color="fg.muted">
                    {lite.note}
                  </Text>
                )}
              </>
            )}
          </SettingRow>
        )}
      </SettingList>
    </Card>
  );
}
