/**
 * The library's "Move to product…": gives a board another home, so another product's sidebar
 * lists it. Its id and address stay, so old links keep opening it. Mounted by its opener while
 * open, so each opening starts at the board's current product.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import {
  type DashboardHomeProduct,
  type DashboardViewer,
  homeAllowsScope,
  isDashboardAuthor,
} from "@langwatch/dashboard-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { useState } from "react";

import {
  HOME_PRODUCT_LABELS,
  LIBRARY_PRODUCT_ORDER,
  type LibraryBoard,
} from "../../model/organization-library.ts";

const OLD_LINKS = "Old links keep opening it.";

/** The server refuses anyone else's move of a Project board out of LLM Ops. */
const AUTHOR_ONLY = "Only its author can move a Project board out of LLM Ops.";

/** Whether `to` would take a Project board out of the one product with projects. */
const losesProject = ({ board, to }: { board: LibraryBoard; to: DashboardHomeProduct }) =>
  !homeAllowsScope({ homeProduct: to, scope: board.scope });

/** The author's move of a Project board out of LLM Ops narrows it to Only me; said first. */
function sharingNote({ board, to }: { board: LibraryBoard; to: DashboardHomeProduct }) {
  if (!losesProject({ board, to })) return null;
  return `${HOME_PRODUCT_LABELS[to]} has no projects, so only you will see it until you share it.`;
}

export function MoveBoardDialog({
  board,
  userId,
  isMoving,
  onMove,
  onClose,
}: {
  board: LibraryBoard;
  userId: string | undefined;
  isMoving: boolean;
  /** Moves the board; true once it moved, which closes the dialog. */
  onMove: (homeProduct: DashboardHomeProduct) => Promise<boolean>;
  onClose: () => void;
}) {
  const current = board.homeProduct;
  const [target, setTarget] = useState<DashboardHomeProduct>(current);
  const viewer: DashboardViewer | undefined = userId === void 0 ? void 0 : { userId };
  const isAuthor = isDashboardAuthor({ board, viewer });
  const refusedFor = (product: DashboardHomeProduct) =>
    !isAuthor && losesProject({ board, to: product });
  const isLocked = LIBRARY_PRODUCT_ORDER.some(refusedFor);
  const note = sharingNote({ board, to: target });

  const submit = async () => {
    if (isMoving || target === current) return;
    if (await onMove(target)) onClose();
  };

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title="Move to product"
      description={`Pick the product whose sidebar lists "${board.name}". ${OLD_LINKS}`}
      busy={isMoving}
      showCloseButton={false}
      onSubmit={() => void submit()}
      footerContent={
        <MoveFooter isMoving={isMoving} isUnchanged={target === current} onCancel={onClose} />
      }
    >
      <VStack align="stretch" gap={3}>
        <DestinationRadios
          current={current}
          target={target}
          refusedFor={refusedFor}
          onPick={setTarget}
        />
        {isLocked && (
          <Text textStyle="caption" color="fg.muted">
            {AUTHOR_ONLY}
          </Text>
        )}
        {note && (
          <Text
            textStyle="caption"
            color="fg.muted"
            background="orange.subtle"
            borderRadius="md"
            paddingX={3}
            paddingY={2}
          >
            {note}
          </Text>
        )}
      </VStack>
    </Dialog>
  );
}

/** Every product as a destination, the current one marked; a refused one disabled, saying why. */
function DestinationRadios({
  current,
  target,
  refusedFor,
  onPick,
}: {
  current: DashboardHomeProduct;
  target: DashboardHomeProduct;
  refusedFor: (product: DashboardHomeProduct) => boolean;
  onPick: (product: DashboardHomeProduct) => void;
}) {
  return (
    <RadioGroup
      aria-label="Product"
      value={target}
      onValueChange={(details: { value: string | null }) => {
        const picked = LIBRARY_PRODUCT_ORDER.find((product) => product === details.value);
        if (picked) onPick(picked);
      }}
    >
      <VStack align="stretch" gap={2}>
        {LIBRARY_PRODUCT_ORDER.map((product) => (
          <Radio
            key={product}
            value={product}
            disabled={refusedFor(product)}
            title={refusedFor(product) ? AUTHOR_ONLY : void 0}
          >
            <HStack gap={2}>
              <Text textStyle="bodySm" fontWeight="medium">
                {HOME_PRODUCT_LABELS[product]}
              </Text>
              {product === current && (
                <Text textStyle="caption" color="fg.subtle">
                  Current
                </Text>
              )}
            </HStack>
          </Radio>
        ))}
      </VStack>
    </RadioGroup>
  );
}

function MoveFooter({
  isMoving,
  isUnchanged,
  onCancel,
}: {
  isMoving: boolean;
  isUnchanged: boolean;
  onCancel: () => void;
}) {
  return (
    <HStack justify="flex-end" gap={2} width="full">
      <Button size="sm" variant="ghost" disabled={isMoving} onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" type="submit" colorPalette="teal" disabled={isUnchanged} loading={isMoving}>
        Move
      </Button>
    </HStack>
  );
}
