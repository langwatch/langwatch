// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { ListTable } from "@langwatch/design-system/list-table";
import { Badge, Button, Text, VStack } from "@langwatch/design-system/primitives";
import type { CouponView, PromotionCodeView } from "@langwatch/enterprise-billing-contract";

import {
  discountLabel,
  durationLabel,
  productsLabel,
  redemptionsLabel,
} from "../../model/coupon-form.ts";

const COLUMN_COUNT = 8;

const dateLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" })
    : "Never";

/** Every coupon as a row, each of its promotion codes beneath it with its checkout verdict. */
export function CouponsTable({
  coupons,
  onDeactivate,
}: {
  coupons: CouponView[];
  onDeactivate: (code: PromotionCodeView) => void;
}) {
  return (
    <ListTable variant="embedded" density="compact" scroll="x" scrollLabel="Coupons table">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Coupon or code</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Discount</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Duration</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Applies to</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Redemptions</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Expires</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Growth checkout</ListTable.ColumnHeader>
          <ListTable.ColumnHeader width="fit" label="Actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {coupons.map((coupon) => (
          <CouponRows key={coupon.id} coupon={coupon} onDeactivate={onDeactivate} />
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

function CouponRows({
  coupon,
  onDeactivate,
}: {
  coupon: CouponView;
  onDeactivate: (code: PromotionCodeView) => void;
}) {
  return (
    <>
      <ListTable.Row>
        <ListTable.Cell>
          <VStack align="start" gap={0}>
            <Text fontWeight="medium">{coupon.name ?? "Unnamed coupon"}</Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              {coupon.id}
            </Text>
          </VStack>
        </ListTable.Cell>
        <ListTable.Cell>{discountLabel(coupon)}</ListTable.Cell>
        <ListTable.Cell>{durationLabel(coupon)}</ListTable.Cell>
        <ListTable.Cell>{productsLabel(coupon.products)}</ListTable.Cell>
        <ListTable.Cell>{redemptionsLabel(coupon)}</ListTable.Cell>
        <ListTable.Cell>{dateLabel(coupon.redeemBy)}</ListTable.Cell>
        <ListTable.Cell>
          {coupon.valid ? null : <Badge colorPalette="gray">No longer valid</Badge>}
        </ListTable.Cell>
        <ListTable.Cell />
      </ListTable.Row>
      {coupon.codes.length === 0 ? (
        <ListTable.SpanRow columns={COLUMN_COUNT}>
          <Text fontSize="sm" color="fg.muted" paddingLeft={6}>
            No promotion code redeems this coupon yet.
          </Text>
        </ListTable.SpanRow>
      ) : null}
      {coupon.codes.map((code) => (
        <CodeRow key={code.id} code={code} onDeactivate={onDeactivate} />
      ))}
    </>
  );
}

function CodeRow({
  code,
  onDeactivate,
}: {
  code: PromotionCodeView;
  onDeactivate: (code: PromotionCodeView) => void;
}) {
  return (
    <ListTable.Row>
      <ListTable.Cell>
        <Text fontFamily="mono" fontSize="sm" paddingLeft={6}>
          {code.code}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell />
      <ListTable.Cell />
      <ListTable.Cell />
      <ListTable.Cell>{redemptionsLabel(code)}</ListTable.Cell>
      <ListTable.Cell>{dateLabel(code.expiresAt)}</ListTable.Cell>
      <ListTable.Cell>
        <Verdict code={code} />
      </ListTable.Cell>
      <ListTable.Cell>
        {code.active ? (
          <Button
            size="sm"
            variant="ghost"
            color="fg.error"
            aria-label={`Deactivate ${code.code}`}
            onClick={() => onDeactivate(code)}
          >
            Deactivate
          </Button>
        ) : null}
      </ListTable.Cell>
    </ListTable.Row>
  );
}

function Verdict({ code }: { code: PromotionCodeView }) {
  const { verdict } = code;
  return (
    <VStack align="start" gap={1}>
      {verdict.accepted ? (
        <Badge colorPalette="green">Works at checkout</Badge>
      ) : (
        <Badge colorPalette="red">Refused</Badge>
      )}
      {verdict.reasons.map((reason) => (
        <Text key={reason.code} fontSize="xs" color="fg.error">
          {reason.message}
        </Text>
      ))}
      {verdict.warnings.map((warning) => (
        <Text key={warning.code} fontSize="xs" color="fg.warning">
          {warning.message}
        </Text>
      ))}
    </VStack>
  );
}
