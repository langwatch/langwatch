import {
  Alert,
  Badge,
  Box,
  Button,
  chakra,
  Flex,
  Input,
  NativeSelect,
  Spinner,
  Tabs,
  Text,
  Textarea,
} from "@langwatch/design-system/primitives";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CodeFrame } from "../code/code-block.tsx";
import { CodeBody, CopyAction } from "../code/code-parts.tsx";
import type { CodeSource } from "../code/code-parts.tsx";
import { usePreference, writePreference } from "../lib/storage.ts";
import { readingTabList, readingTabTrigger } from "../mdx-components/tabs.tsx";
import {
  exampleFromSchema,
  generateExample,
  initialBodyOf,
  liveRequest,
  paramKey,
} from "./codegen.ts";
import { useEndpointState } from "./endpoint-state.tsx";
import { EXAMPLE_LANGUAGES } from "./operation.ts";
import type { HighlightedExamples, Operation, Parameter } from "./operation.ts";
import { Panel } from "./panel.tsx";
import { ResponsiveExamples } from "./responsive-examples.tsx";

type Outcome =
  | { kind: "idle" }
  | { kind: "sending" }
  | {
      kind: "response";
      status: number;
      statusText: string;
      ms: number;
      contentType: string;
      body: string;
      headers: [string, string][];
    }
  | { kind: "error"; message: string; retry: boolean };

const REQUEST_TIMEOUT_MS = 30000;

function plainLines({ code }: { code: string }): string[] {
  return code
    .split("\n")
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
}

function plainSource({ code }: { code: string }): CodeSource {
  return {
    lang: "json",
    title: "Example",
    code,
    lines: plainLines({ code }),
    highlight: [],
    numbered: false,
  };
}

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
  const options = param.schema.enum;
  const numeric = param.schema.type === "integer" || param.schema.type === "number";
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
      {options ? (
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
      ) : param.schema.type === "boolean" ? (
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
      ) : (
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
      )}
      {error ? (
        <Text id={`${id}-error`} margin="0" marginTop="1" fontSize="12px" color="red.fg">
          {error}
        </Text>
      ) : null}
    </Box>
  );
}

export function Playground({
  operation,
  highlighted,
  slug,
}: {
  operation: Operation;
  highlighted?: HighlightedExamples;
  slug: string;
}) {
  const bodyContent = operation.body?.contents.find((content) => content.type.includes("json"));
  const initialBody = initialBodyOf({ operation });
  const [values, setValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState(initialBody);
  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const { tryOpen, setTryOpen, status, setStatus } = useEndpointState();
  const statuses = operation.responses.map((response) => response.status);
  const stored = usePreference({ key: "api-language" });
  const language =
    EXAMPLE_LANGUAGES.find((entry) => entry.label.toLowerCase() === stored?.toLowerCase())?.id ??
    "python";
  const languageLabel = EXAMPLE_LANGUAGES.find((entry) => entry.id === language)?.label ?? "Python";
  const [touched, setTouched] = useState(false);
  const state = { values, body };
  const host = operation.origin.replace(/^https?:\/\//, "");
  const required = operation.parameters.filter((param) => param.required);
  const optional = operation.parameters.filter((param) => !param.required && !param.deprecated);
  const deprecated = operation.parameters.filter((param) => !param.required && param.deprecated);
  const scheme = operation.schemes[0];
  const jsonOnly = !operation.body || Boolean(bodyContent);
  const mutating = operation.method !== "GET";

  const examples = useMemo(
    () =>
      Object.fromEntries(
        EXAMPLE_LANGUAGES.map((entry) => {
          const code = generateExample({ operation, state: { values, body }, language: entry.id });
          const initial = highlighted?.[entry.id];
          const lines = !touched && initial ? initial : plainLines({ code });
          const source: CodeSource = {
            lang: entry.lang,
            title: entry.label,
            code,
            lines,
            highlight: [],
            numbered: false,
          };
          return [entry.id, source];
        }),
      ),
    [operation, values, body, highlighted, touched],
  );

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (!tryOpen) return;
    formRef.current?.scrollIntoView({ block: "nearest" });
    formRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, [tryOpen]);

  const edit = ({ location, name, value }: { location: string; name: string; value: string }) => {
    setTouched(true);
    setValues((previous) => ({ ...previous, [paramKey({ location, name })]: value }));
  };

  const send = async () => {
    const nextErrors: Record<string, string> = {};
    for (const param of required) {
      if (!values[paramKey({ location: param.in, name: param.name })]?.trim())
        nextErrors[paramKey({ location: param.in, name: param.name })] =
          `${param.name} is required.`;
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
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const first = Object.keys(nextErrors)[0];
      document
        .getElementById(
          first === "auth"
            ? "pg-auth"
            : first === "body"
              ? "pg-body"
              : `pg-${first.replace(":", "-")}`,
        )
        ?.focus();
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

  const renderParam = (param: Parameter) => (
    <ParamInput
      key={`${param.in}:${param.name}`}
      param={param}
      value={values[paramKey({ location: param.in, name: param.name })] ?? ""}
      error={errors[paramKey({ location: param.in, name: param.name })]}
      onChange={(value) => edit({ location: param.in, name: param.name, value })}
    />
  );

  const closeForm = () => {
    setTryOpen(false);
    window.setTimeout(() => document.getElementById("try-it-button")?.focus(), 0);
  };
  const chosen =
    operation.responses.find((response) => response.status === status) ?? operation.responses[0];
  const chosenContent = chosen?.contents[0];
  const declared = chosenContent?.example;
  const example =
    declared ??
    (chosenContent?.schema ? exampleFromSchema({ schema: chosenContent.schema }) : undefined);
  const exampleCode =
    example === undefined || example === null || JSON.stringify(example) === "{}"
      ? ""
      : JSON.stringify(example, null, 2);

  return (
    <Flex direction="column" gap="6" minWidth="0" data-type-mode="productive">
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
            {scheme ? (
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
                <summary>
                  API key · {scheme.type === "apiKey" ? scheme.name : "Authorization"}
                </summary>
                <Flex gap="2" marginTop="1">
                  <Input
                    id="pg-auth"
                    aria-invalid={Boolean(errors.auth)}
                    size="sm"
                    type={reveal ? "text" : "password"}
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
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
                    {reveal ? (
                      <EyeOff size={16} aria-hidden="true" />
                    ) : (
                      <Eye size={16} aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    colorPalette="gray"
                    onClick={() => setKey("")}
                  >
                    Clear
                  </Button>
                </Flex>
                {errors.auth ? (
                  <Text color="red.fg" fontSize="12px">
                    {errors.auth}
                  </Text>
                ) : null}
                <Text margin="0" marginTop="1" fontSize="12px" color="fg.muted">
                  Kept in this tab. Cleared when you reload.
                </Text>
              </chakra.details>
            ) : null}

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

            {operation.body && bodyContent ? (
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
                  aria-invalid={errors.body ? true : undefined}
                  aria-describedby={errors.body ? "pg-body-error" : undefined}
                  onChange={(event) => {
                    setTouched(true);
                    setBody(event.target.value);
                  }}
                />
                {errors.body ? (
                  <Text id="pg-body-error" margin="0" marginTop="1" fontSize="12px" color="red.fg">
                    {errors.body}
                  </Text>
                ) : null}
              </Box>
            ) : null}

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
                    borderRadius="full"
                    bg="fg"
                    color="fg.inverted"
                    _hover={{ bg: "fg", opacity: 0.9 }}
                    disabled={outcome.kind === "sending"}
                    onClick={send}
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
                      onClick={() => controller.current?.abort("cancel")}
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
          </Flex>
        </Panel>
      ) : null}

      <ResponsiveExamples>
        <Panel showHeader={false} title="Request example">
          <Tabs.Root
            value={languageLabel}
            onValueChange={({ value }) => writePreference({ key: "api-language", value })}
            variant="line"
            colorPalette="accent"
            minWidth="0"
            maxWidth="100%"
          >
            <Flex
              alignItems="center"
              borderBottomWidth="1px"
              borderColor="border.nested"
              paddingX="2"
              bg="bg.subtle"
            >
              <Tabs.List
                css={{
                  ...readingTabList,
                  flex: 1,
                  minWidth: 0,
                  borderBottomWidth: 0,
                  boxShadow: "none",
                }}
              >
                {EXAMPLE_LANGUAGES.map((entry) => (
                  <Tabs.Trigger key={entry.id} value={entry.label} css={readingTabTrigger}>
                    {entry.label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              <CopyAction code={examples[language].code} />
            </Flex>
            {EXAMPLE_LANGUAGES.map((entry) => (
              <Tabs.Content
                key={entry.id}
                value={entry.label}
                padding="0"
                data-docs-panel=""
                bg="bg.nested"
                minWidth="0"
                maxWidth="100%"
                overflow="hidden"
              >
                <CodeBody source={examples[entry.id]} expanded />
              </Tabs.Content>
            ))}
          </Tabs.Root>
        </Panel>

        {statuses.length > 0 ? (
          <Panel showHeader={false} title="Documented response">
            <Flex
              alignItems="center"
              bg="bg.subtle"
              borderBottomWidth="1px"
              borderColor="border"
              paddingInlineEnd="2"
            >
              <Tabs.Root
                value={status}
                onValueChange={({ value }) => setStatus(value)}
                variant="line"
                colorPalette="accent"
                minWidth="0"
                flex="1"
              >
                <Tabs.List
                  aria-label="Response status"
                  css={{ ...readingTabList, paddingInline: "8px", borderBottomWidth: "0" }}
                >
                  {statuses.map((entry) => (
                    <Tabs.Trigger
                      key={entry}
                      value={entry}
                      css={{ ...readingTabTrigger, paddingX: "2", fontSize: "12px" }}
                    >
                      {entry}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
              </Tabs.Root>
              {exampleCode ? <CopyAction code={exampleCode} label="Copy example" /> : null}
            </Flex>
            <Box paddingX="4" paddingTop="3" fontSize="12px" lineHeight="18px" color="fg.muted">
              <Text margin="0">{chosen?.description}</Text>
              {chosenContent ? (
                <Text margin="0">
                  {exampleCode
                    ? declared !== undefined
                      ? "Declared example"
                      : "Example from schema"
                    : "Response fields are not specified"}{" "}
                  · {chosenContent.type}
                </Text>
              ) : null}
            </Box>
            {exampleCode ? (
              <Box marginTop="3" bg="bg.nested" borderTopWidth="1px" borderColor="border.nested">
                <CodeBody source={plainSource({ code: exampleCode })} expanded={false} />
              </Box>
            ) : (
              <Box height="3" />
            )}
          </Panel>
        ) : null}
      </ResponsiveExamples>
      {outcome.kind !== "idle" ? (
        <Panel title="Live response">
          <Box padding="4" aria-live="polite">
            <ResponseArea outcome={outcome} onRetry={send} curl={examples.curl.code} />
          </Box>
        </Panel>
      ) : null}
      <span className="docs-sr-only">{slug}</span>
    </Flex>
  );
}

function ResponseArea({
  outcome,
  onRetry,
  curl,
}: {
  outcome: Outcome;
  onRetry: () => void;
  curl: string;
}) {
  if (outcome.kind === "idle") {
    return (
      <Text margin="0" fontSize="13px" color="fg.muted">
        Send a request to see the response.
      </Text>
    );
  }
  if (outcome.kind === "sending") {
    return (
      <Flex alignItems="center" gap="2" fontSize="13px" color="fg.muted">
        <Spinner size="sm" /> Waiting for a response...
      </Flex>
    );
  }
  if (outcome.kind === "error") {
    return (
      <Alert.Root status="warning" variant="outline">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>{outcome.message}</Alert.Description>
          <Flex gap="2" marginTop="2">
            <Button type="button" size="xs" variant="outline" colorPalette="gray" onClick={onRetry}>
              Retry
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              colorPalette="gray"
              onClick={() => navigator.clipboard.writeText(curl)}
            >
              Copy curl
            </Button>
          </Flex>
        </Alert.Content>
      </Alert.Root>
    );
  }
  let pretty = outcome.body;
  try {
    pretty = JSON.stringify(JSON.parse(outcome.body), null, 2);
  } catch {
    pretty = outcome.body;
  }
  const source: CodeSource = {
    lang: "json",
    title: "Body",
    code: pretty,
    lines: plainLines({ code: pretty }),
    highlight: [],
    numbered: false,
  };
  return (
    <Box>
      <Flex gap="3" alignItems="center" fontSize="12px" wrap="wrap" marginBottom="2">
        <Badge
          size="sm"
          variant="subtle"
          colorPalette={outcome.status < 300 ? "green" : outcome.status < 500 ? "yellow" : "red"}
        >
          {outcome.status} {outcome.statusText}
        </Badge>
        <Text as="span" color="fg.muted">
          {outcome.ms} ms · {outcome.contentType}
        </Text>
      </Flex>
      <CodeFrame>
        <CodeBody source={source} expanded={false} />
      </CodeFrame>
    </Box>
  );
}
