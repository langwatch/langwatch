import {
  Badge,
  Box,
  Button,
  chakra,
  Flex,
  Input,
  NativeSelect,
  Spinner,
  Text,
  Textarea,
} from "@langwatch/design-system/primitives";
import { Eye, EyeOff } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import type { RequestState } from "./codegen.ts";
import { liveRequest, paramKey } from "./codegen.ts";
import { useEndpointState } from "./endpoint-state.tsx";
import type { Operation, Parameter, Scheme } from "./operation.ts";
import { Panel } from "./panel.tsx";
import type { Outcome } from "./playground-outcome.ts";
import { ResponseArea } from "./playground-response.tsx";

const REQUEST_TIMEOUT_MS = 30000;
function ParamInput({
  param,
  value,
  error,
  onChange,
}: {
  param: Parameter;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `pg-${param.in}-${param.name}`;
  return (
    <Box>
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
      <ParamControl param={param} value={value} error={error} onChange={onChange} />
      {error ? (
        <Text id={`${id}-error`} margin="0" marginTop="1" fontSize="12px" color="red.fg">
          {error}
        </Text>
      ) : null}
    </Box>
  );
}

function ParamControl({
  param,
  value,
  error,
  onChange,
}: {
  param: Parameter;
  value: string;
  error?: string;
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
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      onChange={(event) => onChange(event.target.value)}
      autoComplete="off"
      spellCheck={false}
    />
  );
}
function AuthField({
  scheme,
  value,
  error,
  onChange,
}: {
  scheme?: Scheme;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const [reveal, setReveal] = useState(false);
  if (!scheme) return null;
  return (
    <chakra.details
      open
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
      <Flex gap="2" marginTop="1">
        <Input
          id="pg-auth"
          aria-invalid={Boolean(error)}
          size="sm"
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={scheme.type === "apiKey" ? "API key" : "Bearer token"}
          aria-label={scheme.type === "apiKey" ? `${scheme.name} value` : "Bearer token"}
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          colorPalette="gray"
          aria-label={reveal ? "Hide key" : "Reveal key"}
          onClick={() => setReveal((value) => !value)}
        >
          {reveal ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </Button>
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
      {error ? (
        <Text color="red.fg" fontSize="12px">
          {error}
        </Text>
      ) : null}
      <Text margin="0" marginTop="1" fontSize="12px" color="fg.muted">
        Kept in this tab. Cleared when you reload.
      </Text>
    </chakra.details>
  );
}
function SendActions({
  outcome,
  mutating,
  jsonOnly,
  host,
  onSend,
  onCancel,
}: {
  outcome: Outcome;
  mutating: boolean;
  jsonOnly: boolean;
  host: string;
  onSend: () => void;
  onCancel: () => void;
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
            disabled={outcome.kind === "sending"}
            id="pg-send"
            onClick={onSend}
          >
            {outcome.kind === "sending" ? (
              <>
                <Spinner size="sm" /> Sending...
              </>
            ) : (
              "Send request"
            )}
          </Button>
          {outcome.kind === "sending" ? (
            <Button
              type="button"
              variant="outline"
              colorPalette="gray"
              height="44px"
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
        </Flex>
      ) : (
        <Text margin="0" fontSize="13px" color="fg.muted">
          This request cannot be sent from the browser. Run this request in your terminal.
        </Text>
      )}
    </Box>
  );
}
function validateRequest({
  operation,
  state,
  key,
}: {
  operation: Operation;
  state: RequestState;
  key: string;
}) {
  const { values, body } = state;
  const required = operation.parameters.filter((param) => param.required);
  const scheme = operation.schemes[0];
  const nextErrors: Record<string, string> = {};
  for (const param of required) {
    if (!values[paramKey({ location: param.in, name: param.name })]?.trim())
      nextErrors[paramKey({ location: param.in, name: param.name })] = `${param.name} is required.`;
  }
  if (scheme && !key.trim()) nextErrors.auth = "Enter an API key.";
  if (operation.body?.required && !body.trim()) nextErrors.body = "Enter a request body.";
  if (body.trim()) {
    try {
      JSON.parse(body);
    } catch (error) {
      nextErrors.body = `Invalid JSON: ${error instanceof Error ? error.message : "could not parse"}`;
    }
  }
  return nextErrors;
}

function errorFieldId({ first }: { first: string }) {
  if (first === "auth") return "pg-auth";
  if (first === "body") return "pg-body";
  return `pg-${first.replace(":", "-")}`;
}

function BodyEditor({
  body,
  error,
  onChange,
}: {
  body: string;
  error?: string;
  onChange: (value: string) => void;
}) {
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
      <Textarea
        id="pg-body"
        size="sm"
        rows={Math.min(14, Math.max(4, body.split("\n").length))}
        fontFamily="mono"
        fontSize="12px"
        value={body}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "pg-body-error" : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {error ? (
        <Text id="pg-body-error" margin="0" marginTop="1" fontSize="12px" color="red.fg">
          {error}
        </Text>
      ) : null}
    </Box>
  );
}

function ParameterFields({
  parameters,
  values,
  errors,
  onEdit,
}: {
  parameters: Parameter[];
  values: Record<string, string>;
  errors: Record<string, string>;
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
      error={errors[paramKey({ location: param.in, name: param.name })]}
      onChange={(value) => onEdit({ location: param.in, name: param.name, value })}
    />
  );
  return (
    <>
      {" "}
      {required.length > 0 ? (
        <Flex direction="column" gap="3">
          {required.map(renderParam)}
        </Flex>
      ) : null}
      {optional.length > 0 ? (
        <Flex direction="column" gap="3">
          {optional.map(renderParam)}
        </Flex>
      ) : null}
      {deprecated.length > 0 ? (
        <chakra.details
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
  curl,
  children,
  onChange,
  onTouched,
}: {
  operation: Operation;
  state: RequestState;
  curl: string;
  children: ReactNode;
  onChange: (state: RequestState) => void;
  onTouched: () => void;
}) {
  const { values, body } = state;
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [key, setKey] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const controller = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const { tryOpen, setTryOpen } = useEndpointState();
  const scheme = operation.schemes[0];
  const bodyContent = operation.body?.contents.find((content) => content.type.includes("json"));
  const jsonOnly = !operation.body || Boolean(bodyContent);
  const mutating = operation.method !== "GET";
  const host = operation.origin.replace(/^https?:\/\//, "");
  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (!tryOpen) return;
    formRef.current?.scrollIntoView({ block: "nearest" });
    formRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, [tryOpen]);

  const edit = ({ location, name, value }: { location: string; name: string; value: string }) => {
    onTouched();
    onChange({ ...state, values: { ...values, [paramKey({ location, name })]: value } });
  };

  const send = async () => {
    const nextErrors = validateRequest({ operation, state, key });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const first = Object.keys(nextErrors)[0];
      document.getElementById(errorFieldId({ first }))?.focus();
      return;
    }
    const request = liveRequest({ operation, state, key });
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort("timeout"), REQUEST_TIMEOUT_MS);
    setOutcome({ kind: "sending" });
    const started = performance.now();
    try {
      const response = await fetch(request.url, {
        method: operation.method,
        headers: request.headers,
        body: request.body,
        signal: abort.signal,
      });
      const text = await response.text();
      setOutcome({
        kind: "response",
        status: response.status,
        statusText: response.statusText,
        ms: Math.round(performance.now() - started),
        contentType: response.headers.get("content-type") ?? "unknown",
        body: text,
        headers: [...response.headers.entries()],
      });
    } catch {
      if (abort.signal.aborted) {
        setOutcome({
          kind: "error",
          message: abort.signal.reason === "timeout" ? "Request timed out" : "Request cancelled",
          retry: true,
        });
      } else {
        setOutcome({
          kind: "error",
          message:
            "The browser could not reach this endpoint. Copy the curl request to run it locally.",
          retry: true,
        });
      }
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const closeForm = () => {
    setTryOpen(false);
    window.setTimeout(() => document.getElementById("try-it-button")?.focus(), 0);
  };
  return (
    <>
      {tryOpen ? (
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
            <AuthField scheme={scheme} value={key} error={errors.auth} onChange={setKey} />

            <ParameterFields
              parameters={operation.parameters}
              values={values}
              errors={errors}
              onEdit={edit}
            />

            {operation.body && bodyContent ? (
              <BodyEditor
                body={body}
                error={errors.body}
                onChange={(value) => {
                  onTouched();
                  onChange({ ...state, body: value });
                }}
              />
            ) : null}

            <SendActions
              outcome={outcome}
              mutating={mutating}
              jsonOnly={jsonOnly}
              host={host}
              onSend={send}
              onCancel={() => controller.current?.abort("cancel")}
            />
          </Flex>
        </Panel>
      ) : null}
      {children}
      {outcome.kind !== "idle" ? (
        <Panel title="Live response">
          <Box padding="4" aria-live="polite">
            <ResponseArea outcome={outcome} onRetry={send} curl={curl} />
          </Box>
        </Panel>
      ) : null}
    </>
  );
}
