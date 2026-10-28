import { InputGroup } from "@langwatch/design-system/input-group";
import {
  Badge,
  Box,
  Button,
  chakra,
  Flex,
  IconButton,
  Input,
  NativeSelect,
  Text,
  Textarea,
} from "@langwatch/design-system/primitives";
import { Eye, EyeOff } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { docsAppOrigin } from "../../../config.ts";
import type { RequestState } from "../model/codegen.ts";
import { paramKey } from "../model/codegen.ts";
import { sessionCovers } from "../model/docs-session.ts";
import { JSON_TOKEN_COLOURS, jsonTokens } from "../model/json-tokens.ts";
import type { Operation, Parameter, Scheme } from "../model/operation.ts";
import { useEndpointState } from "./endpoint-state.tsx";
import { Panel } from "./panel.tsx";

function ParamInput({
  param,
  value,
  onChange,
}: {
  param: Parameter;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `pg-${param.in}-${param.name}`;
  return (
    <Box className="docs-request-field" title={param.description}>
      <chakra.label
        htmlFor={id}
        display="flex"
        alignItems="center"
        gap="2"
        fontSize="13px"
        lineHeight="20px"
        fontWeight="600"
        marginBottom="1"
      >
        <Box as="span" fontFamily="mono">
          {param.name}
        </Box>
        <Text as="span" fontWeight="400" color="fg.muted" fontSize="12px">
          {param.schema.type === "array" ? "array" : (param.schema.type ?? "string")}
          {param.required ? " · Required" : ""}
        </Text>
        {param.deprecated ? (
          <Badge size="sm" variant="subtle" colorPalette="yellow">
            Deprecated
          </Badge>
        ) : null}
      </chakra.label>
      <ParamControl param={param} value={value} onChange={onChange} />
    </Box>
  );
}

function ParamControl({
  param,
  value,
  onChange,
}: {
  param: Parameter;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `pg-${param.in}-${param.name}`;
  const options = param.schema.enum;
  const numeric = param.schema.type === "integer" || param.schema.type === "number";
  if (options)
    return (
      <NativeSelect.Root size="sm">
        <NativeSelect.Field
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{param.required ? "Select a value" : "Omit"}</option>
          {options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    );
  if (param.schema.type === "boolean")
    return (
      <NativeSelect.Root size="sm">
        <NativeSelect.Field
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Omit</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    );
  return (
    <Input
      id={id}
      size="sm"
      value={value}
      inputMode={numeric ? "numeric" : undefined}
      placeholder={param.name}
      onChange={(event) => onChange(event.target.value)}
      autoComplete="off"
      spellCheck={false}
    />
  );
}
function AuthField({
  scheme,
  value,
  onChange,
}: {
  scheme?: Scheme;
  value: string;
  onChange: (value: string) => void;
}) {
  const [reveal, setReveal] = useState(false);
  if (!scheme) return null;
  return (
    <chakra.details
      open
      className="docs-disclosure"
      css={{
        "& > summary": {
          cursor: "pointer",
          minHeight: "44px",
          display: "flex",
          alignItems: "center",
          fontSize: "13px",
          fontWeight: 600,
        },
      }}
    >
      <summary>API key · {scheme.type === "apiKey" ? scheme.name : "Authorization"}</summary>
      {docsAppOrigin && sessionCovers({ scheme }) ? <SessionControls /> : null}
      <Box data-docs-manual-key="">
        <Flex gap="2" marginTop="1" align="center">
          <InputGroup
            flex="1"
            endElement={
              <IconButton
                type="button"
                size="xs"
                variant="ghost"
                colorPalette="gray"
                aria-label={reveal ? "Hide key" : "Reveal key"}
                onClick={() => setReveal((value) => !value)}
              >
                {reveal ? (
                  <EyeOff size={16} aria-hidden="true" />
                ) : (
                  <Eye size={16} aria-hidden="true" />
                )}
              </IconButton>
            }
          >
            <Input
              id="pg-auth"
              size="sm"
              type={reveal ? "text" : "password"}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={scheme.type === "apiKey" ? "API key" : "Bearer token"}
              aria-label={scheme.type === "apiKey" ? `${scheme.name} value` : "Bearer token"}
              autoComplete="off"
              spellCheck={false}
            />
          </InputGroup>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            colorPalette="gray"
            onClick={() => onChange("")}
          >
            Clear
          </Button>
        </Flex>
        <Text margin="0" marginTop="1" fontSize="12px" color="fg.muted">
          Kept in this tab. Cleared when you reload.
        </Text>
      </Box>
    </chakra.details>
  );
}
/**
 * Room for the app's session frame (ADR-185, amendment of 2026-10-28), which holds the
 * reader's key and its own Use my LangWatch account button. The playground island embeds it.
 */
function SessionControls() {
  return <div className="docs-session" data-docs-session-frame="" />;
}

function SendActions({
  mutating,
  jsonOnly,
  host,
}: {
  mutating: boolean;
  jsonOnly: boolean;
  host: string;
}) {
  return (
    <Box>
      {mutating ? (
        <Text margin="0" marginBottom="2" fontSize="12px" color="fg.muted">
          This sends a live request to {host}.
        </Text>
      ) : null}
      {jsonOnly ? (
        <Flex gap="2">
          <Button
            type="button"
            variant="solid"
            colorPalette="gray"
            flex="1"
            height="44px"
            borderRadius="lg"
            bg="fg"
            color="fg.inverted"
            _hover={{ bg: "docs.body" }}
            id="pg-send"
          >
            Send request
          </Button>
        </Flex>
      ) : (
        <Text margin="0" fontSize="13px" color="fg.muted">
          This request cannot be sent from the browser. Run this request in your terminal.
        </Text>
      )}
    </Box>
  );
}
/* The editor and its coloured copy behind it must lay text out identically. */
const BODY_TEXT = {
  fontFamily: "mono",
  fontSize: "12px",
  lineHeight: "20px",
  paddingX: "10px",
  paddingY: "8px",
  borderWidth: "1px",
  borderRadius: "md",
  letterSpacing: "normal",
} as const;

function BodyEditor({ body, onChange }: { body: string; onChange: (value: string) => void }) {
  const mirror = useRef<HTMLPreElement>(null);
  return (
    <Box>
      <chakra.label
        htmlFor="pg-body"
        display="block"
        fontSize="13px"
        fontWeight="600"
        marginBottom="1"
      >
        Body{" "}
        <Text as="span" fontWeight="400" color="fg.muted">
          (application/json)
        </Text>
      </chakra.label>
      <Box position="relative">
        <chakra.pre
          ref={mirror}
          aria-hidden="true"
          className="docs-json"
          {...BODY_TEXT}
          position="absolute"
          inset="0"
          margin="0"
          overflow="hidden"
          pointerEvents="none"
          borderColor="transparent"
          whiteSpace="pre-wrap"
          overflowWrap="anywhere"
        >
          {jsonTokens({ text: body }).map((token, index) =>
            token.kind === "plain" ? (
              token.text
            ) : (
              <span
                // Tokens never reorder: the index is the token's place in the body.
                key={index}
                style={{
                  ["--sl" as string]: JSON_TOKEN_COLOURS[token.kind].light,
                  ["--sd" as string]: JSON_TOKEN_COLOURS[token.kind].dark,
                }}
              >
                {token.text}
              </span>
            ),
          )}
          {/* A trailing newline needs a character after it to take up its line. */}
          {"\u200b"}
        </chakra.pre>
        <Textarea
          id="pg-body"
          {...BODY_TEXT}
          rows={Math.min(14, Math.max(4, body.split("\n").length))}
          position="relative"
          background="transparent"
          color="transparent"
          css={{ caretColor: "var(--chakra-colors-fg)" }}
          value={body}
          spellCheck={false}
          onScroll={(event) => {
            if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </Box>
    </Box>
  );
}

function ParameterFields({
  parameters,
  values,
  onEdit,
}: {
  parameters: Parameter[];
  values: Record<string, string>;
  onEdit: (input: { location: string; name: string; value: string }) => void;
}) {
  const required = parameters.filter((param) => param.required);
  const optional = parameters.filter((param) => !param.required && !param.deprecated);
  const deprecated = parameters.filter((param) => !param.required && param.deprecated);
  const renderParam = (param: Parameter) => (
    <ParamInput
      key={`${param.in}:${param.name}`}
      param={param}
      value={values[paramKey({ location: param.in, name: param.name })] ?? ""}
      onChange={(value) => onEdit({ location: param.in, name: param.name, value })}
    />
  );
  return (
    <>
      {" "}
      {required.length > 0 ? (
        <Flex className="docs-request-fields" direction="column" gap="3">
          {required.map(renderParam)}
        </Flex>
      ) : null}
      {optional.length > 0 ? (
        <Flex className="docs-request-fields" direction="column" gap="3">
          {optional.map(renderParam)}
        </Flex>
      ) : null}
      {deprecated.length > 0 ? (
        <chakra.details
          className="docs-disclosure"
          css={{
            "& > summary": {
              cursor: "pointer",
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
              fontSize: "13px",
              color: "var(--chakra-colors-fg-muted)",
            },
          }}
        >
          <summary>▸ Optional fields (deprecated)</summary>
          <Flex direction="column" gap="3" marginTop="2">
            {deprecated.map(renderParam)}
          </Flex>
        </chakra.details>
      ) : null}
    </>
  );
}

export function PlaygroundRequest({
  operation,
  state,
  children,
  onChange,
  onTouched,
}: {
  operation: Operation;
  state: RequestState;
  children: ReactNode;
  onChange: (state: RequestState) => void;
  onTouched: () => void;
}) {
  const { values, body } = state;
  const [key, setKey] = useState("");
  const formRef = useRef<HTMLDivElement>(null);
  const { tryOpen, setTryOpen } = useEndpointState();
  const scheme = operation.schemes[0];
  const bodyContent = operation.body?.contents.find((content) => content.type.includes("json"));
  const jsonOnly = !operation.body || Boolean(bodyContent);
  const mutating = operation.method !== "GET";
  const host = operation.origin.replace(/^https?:\/\//, "");

  useEffect(() => {
    if (!tryOpen) return;
    formRef.current?.scrollIntoView({ block: "nearest" });
    formRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, [tryOpen]);

  const edit = ({ location, name, value }: { location: string; name: string; value: string }) => {
    onTouched();
    onChange({ ...state, values: { ...values, [paramKey({ location, name })]: value } });
  };

  const closeForm = () => {
    setTryOpen(false);
    window.setTimeout(() => document.getElementById("try-it-button")?.focus(), 0);
  };
  return (
    <>
      <div hidden={!tryOpen} data-docs-form="">
        <Panel
          id="try-it-form"
          title="Try this endpoint"
          aside={
            <Button
              type="button"
              size="xs"
              variant="ghost"
              colorPalette="gray"
              minHeight="40px"
              flexShrink={0}
              aria-label="Close request form"
              onClick={closeForm}
            >
              Close
            </Button>
          }
        >
          <Flex direction="column" gap="4" padding="4" ref={formRef}>
            <Text margin="0" fontSize="12px" color="fg.muted">
              {host}
            </Text>
            <AuthField scheme={scheme} value={key} onChange={setKey} />

            <ParameterFields parameters={operation.parameters} values={values} onEdit={edit} />

            {operation.body && bodyContent ? (
              <BodyEditor
                body={body}
                onChange={(value) => {
                  onTouched();
                  onChange({ ...state, body: value });
                }}
              />
            ) : null}

            <SendActions mutating={mutating} jsonOnly={jsonOnly} host={host} />
          </Flex>
        </Panel>
      </div>
      {children}
    </>
  );
}
