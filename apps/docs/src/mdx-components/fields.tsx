import { Accordion, Badge, Box, Flex } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { TypeRegion } from "../lib/type-mode.tsx";

type FieldProps = {
  path?: string;
  query?: string;
  body?: string;
  header?: string;
  name?: string;
  type?: string;
  required?: boolean | string;
  deprecated?: boolean | string;
  default?: string;
  children?: ReactNode;
  location?: string;
};

const flag = (value: boolean | string | undefined) => value === true || value === "true";

export function DocsField({
  kind = "param",
  children,
  ...props
}: FieldProps & { kind?: "param" | "response" }) {
  const name = props.name ?? props.path ?? props.query ?? props.body ?? props.header ?? "";
  const inferred = [
    ["path", props.path],
    ["query", props.query],
    ["header", props.header],
    ["body", props.body],
  ].find(([, value]) => Boolean(value));
  const location = props.location ?? inferred?.[0] ?? "";
  const required = flag(props.required);
  return (
    <TypeRegion
      mode="productive"
      paddingY="3"
      borderBottomWidth="1px"
      borderColor="border.muted"
      className="docs-field"
      css={{ "&:last-of-type": { borderBottomWidth: "0" } }}
    >
      <Flex alignItems="center" gap="2" wrap="wrap" rowGap="1">
        <Box
          as="code"
          fontFamily="mono"
          fontSize="13px"
          lineHeight="24px"
          fontWeight="600"
          color="fg"
          wordBreak="break-word"
          overflowWrap="anywhere"
        >
          {name}
        </Box>
        {props.type ? (
          <Box as="span" fontFamily="mono" fontSize="12px" lineHeight="20px" color="fg.muted">
            {props.type}
          </Box>
        ) : null}
        {kind === "param" && location ? (
          <Badge size="sm" variant="subtle" colorPalette="gray">
            {location}
          </Badge>
        ) : null}
        {required ? (
          <Box as="span" fontSize="12px" color="accent.fg">
            required
          </Box>
        ) : null}
        {flag(props.deprecated) ? (
          <Badge size="sm" variant="subtle" colorPalette="yellow">
            Deprecated
          </Badge>
        ) : null}
      </Flex>
      {children ? (
        <Box
          marginTop="1.5"
          fontSize="14px"
          lineHeight="22px"
          color="fg"
          className="docs-field-body"
          css={{ "& p": { margin: "0 0 8px", fontSize: "14px", lineHeight: "22px" } }}
        >
          {children}
        </Box>
      ) : null}
      {props.default !== undefined ? (
        <Box marginTop="1" fontSize="13px" lineHeight="20px" color="fg.muted">
          Default:{" "}
          <Box as="code" fontFamily="mono">
            {String(props.default)}
          </Box>
        </Box>
      ) : null}
    </TypeRegion>
  );
}

export const ParamField = (props: FieldProps) => <DocsField kind="param" {...props} />;
export const ResponseField = (props: FieldProps) => <DocsField kind="response" {...props} />;

export function Expandable({
  title,
  defaultOpen,
  children,
}: {
  title?: string;
  defaultOpen?: boolean | string;
  children?: ReactNode;
}) {
  const label = title ?? "child fields";
  return (
    <Accordion.Root
      collapsible
      multiple
      defaultValue={flag(defaultOpen) ? ["item"] : []}
      variant="plain"
      marginTop="2"
    >
      <Accordion.Item value="item">
        <Accordion.ItemTrigger
          minHeight="44px"
          paddingX="3"
          width="fit-content"
          borderWidth="1px"
          borderColor="border"
          borderRadius="lg"
          gap="2"
          cursor="pointer"
          color="fg.muted"
          fontSize="14px"
        >
          <Accordion.ItemIndicator />
          <Box as="span">{title ? `Show ${label}` : "Show child fields"}</Box>
        </Accordion.ItemTrigger>
        <Accordion.ItemContent data-docs-panel="">
          <Accordion.ItemBody
            paddingStart="4"
            padding="3"
            borderWidth="1px"
            borderRadius="lg"
            marginTop="2"
            borderColor="border.muted"
            marginBottom="2"
          >
            {children}
          </Accordion.ItemBody>
        </Accordion.ItemContent>
      </Accordion.Item>
    </Accordion.Root>
  );
}
