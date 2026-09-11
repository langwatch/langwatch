/**
 * The assertion behind the section's hardest UI rule: a governance page never
 * offers a native `<select>` as its choice control.
 *
 * A native select is the operating system's widget, not ours. It cannot carry
 * the chip's icon or its label-plus-value reading, it ignores the app's
 * palette, and on a dark screen it opens a light list. Every choice on a
 * governance page is either a `FilterChip` (a menu pill) or
 * `~/components/ui/select` (Ark's select, styled by us) — both of which the
 * reader operates through a button and a listbox.
 *
 * WHAT THIS DELIBERATELY DOES NOT COUNT, and only this: Ark's own select mounts
 * a `<select>` (`ChakraSelect.HiddenSelect`) so browser autofill and a plain
 * form submit still work. `@zag-js/select` gives that element BOTH
 * `aria-hidden="true"` and `tabIndex={-1}` — see `getHiddenSelectProps` in
 * `select.connect.mjs` — so no reader reaches it by pointer, by tab, or by
 * screen reader. Counting it would make the rule unsatisfiable for the very
 * component the rule tells pages to use.
 *
 * WHY IT CHECKS THE ELEMENT AND NOT ITS ANCESTORS. An earlier version walked
 * `parentElement` looking for `aria-hidden`, on the theory that hidden is
 * hidden however you inherit it. That version could not fail. Zag marks every
 * element outside an open modal `aria-hidden="true"` (`hideContentBelow` in
 * `@zag-js/dialog` calls `hideOthers`, walking out to `document.body`), so any
 * page rendering a dialog handed the walk a hidden ancestor for free and the
 * assertion returned zero no matter what the page contained. A reachable
 * select is still reachable — the reader closes the dialog and operates it —
 * so an inherited `aria-hidden` is not evidence of anything. Both conditions
 * are read off the element itself, which is where Ark puts them.
 *
 * A plain function rather than a matcher so it carries no test-framework
 * import: page tests assert on it with whatever they already use, typically
 * `expect(findNativeSelects(container)).toHaveLength(0)`.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
export function findNativeSelects(root: ParentNode): HTMLSelectElement[] {
  return [...root.querySelectorAll("select")].filter(
    (element) => !isAutofillShadow(element),
  );
}

/**
 * The signature of a select mounted purely so the browser has something to
 * autofill and a form has something to submit: hidden from assistive
 * technology AND out of the tab order. Either one alone is not enough —
 * `aria-hidden` on a still-tabbable control is a defect, not an exemption, and
 * a `tabIndex={-1}` select is still readable and clickable.
 *
 * Every other native select Ark can render is one a reader is meant to
 * operate — the date picker's month and year, the colour picker's format —
 * and each carries an `aria-label` and no `aria-hidden`. They are counted, and
 * that is the right answer: the rule is about the widget, not about who
 * shipped it.
 *
 * The tab order is read off the `tabIndex` PROPERTY rather than the attribute.
 * The property is defined for every select (0 when nothing is set) and
 * reflects the attribute when there is one, so it survives a future Ark that
 * sets the tab index without writing the markup attribute.
 */
function isAutofillShadow(element: HTMLSelectElement): boolean {
  return (
    element.getAttribute("aria-hidden") === "true" && element.tabIndex === -1
  );
}
