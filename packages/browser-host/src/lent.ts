/**
 * Reads of what peers lent by token. Generic over the token's shape and
 * knowing no feature: the owner's `.lends` and this reader meet at one type.
 * ARCHITECTURE.md 10.1, "A name another module depends on is a token".
 */

import { type ComponentType, createElement, lazy, type ReactNode, Suspense, useMemo } from "react";

import { useUiDeclarations } from "./capabilities.ts";
import type {
  UiComponentToken,
  UiDeclarations,
  UiExtensionToken,
  UiHooksToken,
  UiOperationsToken,
  UiTokenIdentity,
} from "./declarations.ts";

/** One lender of an extension point, with its component. */
export type UiLentComponent<Props> = Readonly<{ owner: string; Component: ComponentType<Props> }>;

/** The lent component of a token, or nothing while no module lends it. */
export function useLent<Props>(token: UiComponentToken<Props>): ComponentType<Props> | undefined {
  const declarations = useUiDeclarations();
  return useMemo(
    () => lentComponents<Props>({ declarations, token })[0]?.Component,
    [declarations, token],
  );
}

/** Every lender of an extension point, in install order. */
export function useLentAll<Props>(
  token: UiExtensionToken<Props>,
): readonly UiLentComponent<Props>[] {
  const declarations = useUiDeclarations();
  return useMemo(() => lentComponents<Props>({ declarations, token }), [declarations, token]);
}

/** The lent operations of a token: call it to load them. */
export function useLentOperations<Operations>(
  token: UiOperationsToken<Operations>,
): (() => Promise<Operations>) | undefined {
  const declarations = useUiDeclarations();
  return useMemo(() => {
    const lend = declarations.lent(token)[0]?.lend;
    if (lend === undefined || !("load" in lend)) return undefined;
    return async () => {
      const loaded = await lend.load();
      if (!isDefaultOf<Operations>(loaded))
        throw new Error(`Lent operations ${token.key} did not load.`);
      return loaded.default;
    };
  }, [declarations, token]);
}

/** The lent hooks of a token: an eager object, because a hook runs in render. */
export function useLentHooks<Hooks>(token: UiHooksToken<Hooks>): Hooks | undefined {
  const declarations = useUiDeclarations();
  return useMemo(() => {
    const lend = declarations.lent(token)[0]?.lend;
    return lend !== undefined && "value" in lend && isObject<Hooks>(lend.value)
      ? lend.value
      : undefined;
  }, [declarations, token]);
}

/** Draws the lent component of a token, or the fallback while nothing lends it. */
export function Lent<Props extends object>({
  of,
  props,
  fallback = null,
}: {
  of: UiComponentToken<Props>;
  props: Props;
  fallback?: ReactNode;
}): ReactNode {
  const Component = useLent(of);
  if (Component === undefined) return fallback;
  return createElement(Suspense, { fallback }, createElement(Component, props));
}

function lentComponents<Props>({
  declarations,
  token,
}: {
  declarations: UiDeclarations;
  token: UiTokenIdentity;
}): readonly UiLentComponent<Props>[] {
  return declarations.lent(token).flatMap(({ module, lend }) => {
    if (!("load" in lend)) return [];
    const Component: unknown = lazy(async () => {
      const loaded = await lend.load();
      if (!isDefaultOf<ComponentType<object>>(loaded)) {
        throw new Error(`Lent component ${token.key} did not load a component.`);
      }
      return loaded;
    });
    return isComponent<Props>(Component) ? [{ owner: module, Component }] : [];
  });
}

function isDefaultOf<Value>(value: unknown): value is { readonly default: Value } {
  return typeof value === "object" && value !== null && "default" in value;
}

function isObject<Value>(value: unknown): value is Value {
  return typeof value === "object" && value !== null;
}

function isComponent<Props>(value: unknown): value is ComponentType<Props> {
  return (
    typeof value === "function" ||
    (typeof value === "object" && value !== null && "$$typeof" in value)
  );
}
