import React from "react";

/**
 * Higher-Order Component that wraps a component with a controller hook.
 * This pattern promotes separation of concerns by isolating business logic
 * from presentation components, following MVC-like architecture principles.
 *
 * @param Component - The presentational component to wrap
 * @param useController - The controller hook that contains business logic
 * @see https://medium.com/@drewdrewthis/cleaner-react-hooks-the-usecontroller-pattern-655512568366
 * @returns A wrapped component with controller logic injected as props
 *
 * @example
 * ```tsx
 * // Define your controller hook
 * const useMyController = (props: MyProps) => {
 *   // Business logic here
 *   return { data, handlers, state };
 * };
 *
 * // Define your presentational component
 * const MyComponent = (props: MyProps & ReturnType<typeof useMyController>) => {
 *   // Pure JSX presentation logic
 *   return <div>...</div>;
 * };
 *
 * // Export the wrapped component
 * export default withController(MyComponent, useMyController);
 * ```
 */
export function withController<P extends object, C>(
  Component: React.ComponentType<P & C>,
  useController: (props: P) => C
): React.ComponentType<P> {
  const WrappedComponent = (props: P) => {
    const controller = useController(props);
    return <Component {...props} {...controller} />;
  };

  WrappedComponent.displayName = `withController(${
    Component.displayName || Component.name || "Component"
  })`;

  return WrappedComponent;
}
