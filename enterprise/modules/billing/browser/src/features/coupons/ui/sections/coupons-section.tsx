// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describeError } from "@langwatch/browser-host/errors";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { ListPage } from "@langwatch/design-system/list-page";
import { PageLayout } from "@langwatch/design-system/page-layout";
import type { CouponsSectionProps } from "@langwatch/enterprise-billing-client";
import type { PromotionCodeView } from "@langwatch/enterprise-billing-contract";
import { Plus, TicketPercent } from "lucide-react";
import { useState } from "react";

import { billingCouponsApi } from "../../behavior/billing-coupons-api.ts";
import { useCouponCommands } from "../../behavior/use-coupon-commands.ts";
import { CouponsTable } from "../blocks/coupons-table.tsx";
import { CreateCouponDrawer } from "./create-coupon-drawer.tsx";

const STRIPE_COUPON_DOCS = {
  kind: "docs",
  label: "How Stripe coupons work",
  href: "https://docs.stripe.com/billing/subscriptions/coupons",
} as const;

/**
 * The Cloud admin console's Coupons page: every Stripe coupon with its promotion codes and
 * whether the Growth checkout takes each, and a drawer that makes only coupons it does.
 */
export default function CouponsSection(_props: CouponsSectionProps) {
  const [creating, setCreating] = useState(false);
  const [deactivating, setDeactivating] = useState<PromotionCodeView | null>(null);
  const list = billingCouponsApi.billingCoupons.list.useQuery({}, { retry: false });
  const commands = useCouponCommands();
  const coupons = list.data?.coupons ?? [];

  const actions = (
    <PageLayout.HeaderButton primary onClick={() => setCreating(true)}>
      <Plus size={20} />
      New coupon
    </PageLayout.HeaderButton>
  );
  const description =
    "Promotion codes customers type at the Growth checkout, and whether that checkout accepts each one. No code discounts the first charge up to the 1st of next month; the discount months count from the day of checkout.";

  const renderPage = () => {
    if (list.error)
      return (
        <ListPage
          title="Coupons"
          description={description}
          actions={actions}
          state="error"
          error={{
            title: "Couldn't load coupons",
            description: describeError({
              error: list.error,
              fallbackTitle: "Couldn't load coupons",
            }),
            onRetry: () => void list.refetch(),
            next: [STRIPE_COUPON_DOCS],
          }}
        >
          {null}
        </ListPage>
      );
    if (!list.isLoading && coupons.length === 0)
      return (
        <ListPage
          title="Coupons"
          description={description}
          actions={actions}
          state="empty"
          empty={{
            icon: <TicketPercent />,
            title: "No coupons yet",
            description:
              "Create a coupon to give a customer a promotion code for the Growth checkout.",
            next: [STRIPE_COUPON_DOCS],
          }}
        >
          {null}
        </ListPage>
      );
    return (
      <ListPage
        title="Coupons"
        description={description}
        actions={actions}
        state={list.isLoading ? "loading" : "ready"}
        refreshing={list.isFetching}
      >
        <CouponsTable coupons={coupons} onDeactivate={setDeactivating} />
      </ListPage>
    );
  };

  return (
    <>
      {renderPage()}
      <CreateCouponDrawer open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title={`Deactivate ${deactivating?.code ?? "this code"}?`}
        description="Customers can no longer redeem it, and its name becomes free for a new coupon. Subscriptions already discounted keep their discount."
        confirmLabel="Deactivate code"
        loading={commands.deactivateCode.isPending}
        onConfirm={() => {
          if (!deactivating) return;
          commands.deactivateCode.mutate(
            { promotionCodeId: deactivating.id },
            { onSuccess: () => setDeactivating(null) },
          );
        }}
      />
    </>
  );
}
