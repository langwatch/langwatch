import type { ComponentType, ReactNode } from "react";
import { Suspense } from "react";
import { RouterProvider, type RouterProviderProps } from "react-router/dom";

export type UiOuterProvider = ComponentType<{ children: ReactNode }>;

export type UiApplicationShellProps = {
  outerProvider: UiOuterProvider;
  router: RouterProviderProps["router"];
};

export function UiApplicationShell({
  outerProvider: OuterProvider,
  router,
}: UiApplicationShellProps) {
  return (
    <OuterProvider>
      <Suspense fallback={null}>
        <RouterProvider router={router} />
      </Suspense>
    </OuterProvider>
  );
}
