import type { ReactNode } from "react";

type ParamFieldProps = {
  path?: string;
  query?: string;
  body?: string;
  header?: string;
  type?: string;
  required?: boolean;
  default?: string;
  children?: ReactNode;
};

export function ParamField({ path, query, body, header, type, required, children, ...rest }: ParamFieldProps) {
  const name = path ?? query ?? body ?? header;
  return (
    <div data-mdx="param-field">
      <code>{name}</code> {type ? <span>{type}</span> : null} {required ? <span>required</span> : null}
      {rest.default ? <span>default: {rest.default}</span> : null}
      {children}
    </div>
  );
}
