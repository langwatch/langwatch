/**
 * Drag to reorder a product sidebar's boards: a pointer drags the whole row, the keyboard moves
 * one with its grip (Space, the arrows, Space; Escape puts it back), and each move is announced
 * by name. The section saves the new order; this only says what it is.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type KeyboardEventHandler,
  type PointerEventHandler,
  type ReactNode,
  useEffect,
  useRef,
} from "react";

import type { SidebarRowDrag } from "../blocks/sidebar-link-row.tsx";
import { RowDragHandle } from "../elements/row-drag-handle.tsx";

/** What a screen reader hears before and while a row moves. */
function announcementsFor(nameOf: (id: unknown) => string) {
  return {
    onDragStart: ({ active }: { active: { id: unknown } }) =>
      `Picked up ${nameOf(active.id)}. Use the arrow keys to move it, Space to drop it, Escape to cancel.`,
    onDragOver: ({ active, over }: { active: { id: unknown }; over: { id: unknown } | null }) =>
      over ? `${nameOf(active.id)} is now at ${nameOf(over.id)}'s place.` : void 0,
    onDragEnd: ({ active, over }: { active: { id: unknown }; over: { id: unknown } | null }) =>
      over ? `Dropped ${nameOf(active.id)} at ${nameOf(over.id)}'s place.` : void 0,
    onDragCancel: ({ active }: { active: { id: unknown } }) =>
      `Moving ${nameOf(active.id)} was cancelled. It is back where it was.`,
  };
}

/**
 * dnd-kit stops the click a pointer drag ends with before React sees it, so the browser would
 * follow the row's link. Held from drag start, this keeps that click from navigating; the stop
 * it returns lets go a moment after the drop, once that click has fired.
 */
function guardDropClick(): () => void {
  const swallow = (event: MouseEvent) => event.preventDefault();
  window.addEventListener("click", swallow, { capture: true });
  return () => {
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 50);
  };
}

/**
 * The context the rows sort in. `ids` are every movable board, shown or not, in their current
 * order; `onReorder` gets them in the new order after a drop that moved one.
 */
export function SortableBoardRows({
  ids,
  names,
  onReorder,
  children,
}: {
  ids: readonly string[];
  names: ReadonlyMap<string, string>;
  onReorder: (ids: readonly string[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const nameOf = (id: unknown) => names.get(String(id)) ?? "the dashboard";
  const clickGuard = useRef<(() => void) | undefined>(void 0);
  // dnd-kit ends no drag when the context unmounts mid-drag, so let the guard go here too.
  useEffect(() => () => clickGuard.current?.(), []);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    clickGuard.current?.();
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove([...ids], from, to));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements: announcementsFor(nameOf) }}
      onDragStart={() => {
        clickGuard.current = guardDropClick();
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => clickGuard.current?.()}
    >
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** A movable row's drag wiring, for `SidebarLinkRow`'s `drag`. */
export function useBoardRowDrag({ id, name }: { id: string; name: string }): SidebarRowDrag {
  const sortable = useSortable({ id });
  return {
    ref: sortable.setNodeRef,
    style: {
      transform: CSS.Translate.toString(sortable.transform),
      transition: sortable.transition,
      opacity: sortable.isDragging ? 0.6 : void 0,
      zIndex: sortable.isDragging ? 1 : void 0,
    },
    onPointerDown: sortable.listeners?.onPointerDown as
      | PointerEventHandler<HTMLElement>
      | undefined,
    handle: (
      <RowDragHandle
        name={name}
        handleRef={sortable.setActivatorNodeRef}
        onKeyDown={
          sortable.listeners?.onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined
        }
        describedBy={sortable.attributes["aria-describedby"]}
      />
    ),
  };
}
