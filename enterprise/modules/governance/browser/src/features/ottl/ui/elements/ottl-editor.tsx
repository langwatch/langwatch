// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * OttlEditor — multi-line statement-list editor for OTTL parserConfig.
 *
 * Each statement is one OpenTelemetry Transformation Language line.
 * The aigateway evaluates them in order against incoming OTLP payloads
 * to map upstream-specific attributes onto the canonical `langwatch.*`
 * namespace. The receiver then reads only canonical fields, so adding
 * a new tool (Codex, Gemini, Copilot Studio…) is data-only.
 *
 * Validation is async — debounced calls go through
 * `api.ingestionSources.validateOttl` to the gateway's `pkg/ottl`
 * parser; the save runs the same check. Errors squiggle at the parser's
 * line/col with a plain-language message under the statement.
 *
 * Spec: specs/ai-governance/ingestion-sources/claude-code-otlp.feature
 */
import { InlineCode } from "@langwatch/design-system/inline-code";
import {
  Alert,
  Box,
  Button,
  HStack,
  IconButton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import {
  describeOttlError,
  ottlValidationErrorSchema,
  type OttlValidationError,
} from "@langwatch/enterprise-governance-contract";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { FileText, Info, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { GovernanceOttlValidationClient } from "../../model/governance-ottl-validation-client.ts";
import { OttlStatementInput } from "./ottl-statement-input.tsx";

interface OttlEditorProps {
  organizationId: string;
  sourceType: string;
  statements: string[];
  onChange: (next: string[]) => void;
  /** Whether to render the editor at all. Caller can hide for source
   *  types that don't accept OTTL (pull-mode adapters etc.). */
  enabled: boolean;
  starterStatements?: readonly string[];
  validationClient: GovernanceOttlValidationClient;
  /** The save's failure, if any; a parser refusal is drawn onto its statements. */
  refusal?: unknown;
}

/**
 * What we know about a statement, which is three things and not two.
 *
 * `unknown` is the one that was missing. When the gateway can't be reached
 * the check never ran, and a two-state model has nowhere to put that — so it
 * was recorded as `ok`, painting a green dot on every line and telling the
 * admin their statements had been validated. A dot that means "we didn't
 * look" has to look different from one that means "this is fine".
 */
type StatementValidity = "valid" | "invalid" | "unknown";

interface PerStatementStatus {
  validity: StatementValidity;
  error: OttlValidationError | null;
}

const VALIDATE_DEBOUNCE_MS = 600;

/** Shared because they are immutable and never rendered per-index. */
const UNKNOWN_STATUS: PerStatementStatus = {
  validity: "unknown",
  error: null,
};
const VALID_STATUS: PerStatementStatus = { validity: "valid", error: null };
const refusedStatementsSchema = ottlValidationErrorSchema.array();

/** The server indexed only the written statements; this maps its indexes back onto the editor's. */
function refusedStatements({
  refusal,
  statements,
}: {
  refusal: unknown;
  statements: string[];
}): OttlValidationError[] | null {
  const parsed = refusedStatementsSchema.safeParse(readHandledError(refusal)?.meta.ottlErrors);
  if (!parsed.success) return null;
  const written = statements.flatMap((s, i) => (s.trim().length > 0 ? [i] : []));
  return parsed.data.map((err) => ({
    ...err,
    statementIndex: written[err.statementIndex] ?? err.statementIndex,
  }));
}

/**
 * Said once, above the list, because the reason belongs to the check and not
 * to any one line. Both cases are ours to fix, not the admin's, so the copy
 * says what is true — nothing looked at these — and never implies a verdict.
 */
const DEFERRED_NOTE: Record<string, string> = {
  gateway_unconfigured:
    "Statement checking is off in this environment, so these haven't been checked. They'll be checked once the gateway is running; you can still save them.",
  endpoint_unavailable:
    "This environment's gateway doesn't support statement checking yet, so these haven't been checked. You can still save them.",
};

type OttlValidationResult = Awaited<ReturnType<GovernanceOttlValidationClient["validate"]>>;

/**
 * Each statement's dot, from the gateway's answer. A deferred answer means
 * nothing checked these, so every dot stays neutral and the note says why.
 */
function readValidation({
  result,
  statements,
}: {
  result: OttlValidationResult;
  statements: string[];
}): { deferredReason: string | null; statuses: PerStatementStatus[] } {
  if (result.status === "deferred") {
    return { deferredReason: result.reason, statuses: statements.map(() => UNKNOWN_STATUS) };
  }
  if (result.status === "valid") {
    return { deferredReason: null, statuses: statements.map(() => VALID_STATUS) };
  }
  const errsByIdx = new Map(result.errors.map((err) => [err.statementIndex, err]));
  return {
    deferredReason: null,
    statuses: statements.map((_, idx): PerStatementStatus => {
      const error = errsByIdx.get(idx);
      return error ? { validity: "invalid", error } : VALID_STATUS;
    }),
  };
}

function matchesStarterStatements({
  starterStatements,
  statements,
}: {
  starterStatements: readonly string[] | undefined;
  statements: string[];
}): boolean {
  if (!starterStatements || starterStatements.length === 0) return false;
  if (starterStatements.length !== statements.length) return false;
  return starterStatements.every((line, i) => line === (statements[i] ?? ""));
}

export function OttlEditor({
  organizationId,
  sourceType: _sourceType,
  statements,
  onChange,
  enabled,
  starterStatements,
  validationClient,
  refusal,
}: OttlEditorProps) {
  const [validationStatus, setValidationStatus] = useState<PerStatementStatus[]>([]);
  const [validating, setValidating] = useState(false);
  /** The failure that stopped validation running at all, if any. */
  const [validationError, setValidationError] = useState<unknown>(null);
  /**
   * Set when the server answered but told us the check didn't run. Not an
   * error — nothing failed — so it gets a note rather than an alert, and the
   * dots stay neutral either way.
   */
  const [deferredReason, setDeferredReason] = useState<string | null>(null);

  const triggerValidation = async (next: string[]) => {
    const nonEmpty = next.filter((s) => s.trim().length > 0);
    if (nonEmpty.length === 0) {
      setValidationError(null);
      setDeferredReason(null);
      setValidationStatus(next.map(() => UNKNOWN_STATUS));
      return;
    }
    setValidating(true);
    try {
      const result = await validationClient.validate({
        organizationId,
        statements: next,
      });
      setValidationError(null);
      const read = readValidation({ result, statements: next });
      setDeferredReason(read.deferredReason);
      setValidationStatus(read.statuses);
    } catch (err) {
      // The check didn't run — the gateway is unreachable, or the request
      // failed on the way there. Don't block save, but don't claim a
      // result either: every statement goes back to `unknown` (neutral
      // dot, no green) and the reason renders once, above the list.
      setValidationError(err);
      setDeferredReason(null);
      setValidationStatus(next.map(() => UNKNOWN_STATUS));
    } finally {
      setValidating(false);
    }
  };

  // Debounced auto-validate on every statement edit. The mutation
  // proxies to the gateway, which is fast — sub-100ms in practice for
  // <16 statements. Tradeoff: if the admin types fast, they see the
  // editor "pending" briefly between strokes; the alternative (validate
  // only on blur) leaves stale red marks visible while editing.
  useEffect(() => {
    const handle = setTimeout(() => {
      void triggerValidation(statements);
    }, VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statements.join("\n")]);

  // A save the server refused for its OTTL lands on the statements it names.
  useEffect(() => {
    const errors = refusedStatements({ refusal, statements });
    if (!errors) return;
    setValidationStatus(
      readValidation({ result: { status: "invalid", errors }, statements }).statuses,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refusal]);

  const updateAt = (idx: number, value: string) => {
    const next = statements.slice();
    next[idx] = value;
    onChange(next);
  };

  const removeAt = (idx: number) => {
    onChange(statements.filter((_, i) => i !== idx));
  };

  const addEmpty = () => {
    onChange([...statements, ""]);
  };

  const useTemplate = () => {
    if (starterStatements) onChange([...starterStatements]);
  };

  const hasStarter = (starterStatements ?? []).length > 0;
  const isEmpty = statements.length === 0;
  const matchesStarter = matchesStarterStatements({ starterStatements, statements });

  if (!enabled) return null;

  return (
    <VStack align="stretch" gap={2}>
      <HStack alignItems="end">
        <VStack align="start" gap={0}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
            OTTL extraction statements
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Each line maps an upstream OTLP attribute onto the canonical{" "}
            <InlineCode>langwatch.*</InlineCode> namespace. The aigateway evaluates them in order
            via embedded <InlineCode>pkg/ottl</InlineCode>.
          </Text>
        </VStack>
        <Spacer />
        {validating && <Spinner size="xs" />}
        {hasStarter && !isEmpty && !matchesStarter && (
          <Button size="xs" variant="ghost" onClick={useTemplate}>
            <RotateCcw size={12} /> Reset to template
          </Button>
        )}
      </HStack>

      {hasStarter && isEmpty && (
        <Box
          borderWidth="1px"
          borderColor="orange.300"
          backgroundColor="orange.subtle"
          borderRadius="md"
          padding={3}
        >
          <HStack alignItems="center" gap={3}>
            <Box color="orange.600">
              <FileText size={18} />
            </Box>
            <VStack align="start" gap={0} flex={1}>
              <Text fontSize="sm" fontWeight="medium">
                Template available for this source type
              </Text>
              <Text fontSize="xs" color="fg.muted">
                Loads the canonical extraction statements maintained by LangWatch. You can customize
                them after loading.
              </Text>
            </VStack>
            <Button size="sm" colorPalette="orange" onClick={useTemplate}>
              Use this template
            </Button>
          </HStack>
        </Box>
      )}

      {/* Why the dots went neutral. Rendered once for the whole editor
          because the failure belongs to the check, not to any one line. */}
      {validationError ? (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Title>Couldn't check these statements</Alert.Title>
        </Alert.Root>
      ) : null}

      {/* The check declined to run. Not a failure, so not an alert — but it
          has to be said out loud, because the absence of red is otherwise
          read as "these are fine". */}
      {!validationError && deferredReason && (
        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          paddingX={3}
          paddingY={2}
        >
          <HStack alignItems="start" gap={2}>
            <Box color="fg.muted" flexShrink={0} marginTop="2px">
              <Info size={14} aria-hidden="true" />
            </Box>
            <Text fontSize="xs" color="fg.muted">
              {DEFERRED_NOTE[deferredReason] ?? "These statements haven't been checked."}
            </Text>
          </HStack>
        </Box>
      )}

      <VStack align="stretch" gap={1}>
        {isEmpty && !hasStarter && (
          <Text fontSize="xs" color="fg.muted" fontStyle="italic">
            No statements. Click “Add statement” to begin.
          </Text>
        )}
        {statements.map((stmt, idx) => {
          const status = validationStatus[idx];
          const isWritten = stmt.trim().length > 0;
          const showError = status?.validity === "invalid" && isWritten;
          const errorMessage = showError ? problemOf({ statement: stmt, status }) : null;
          return (
            <Box key={idx}>
              <HStack alignItems="start" gap={2}>
                <Box
                  width="6px"
                  height="6px"
                  borderRadius="full"
                  marginTop={3}
                  // Green is a positive claim — "the gateway parsed this" —
                  // so it needs a `valid` verdict to earn it. A blank line,
                  // a check that hasn't run yet, and a check that couldn't
                  // run all stay neutral.
                  backgroundColor={statementMarkerColor({
                    showError,
                    isValid: isWritten && status?.validity === "valid",
                  })}
                  flexShrink={0}
                />
                <OttlStatementInput
                  value={stmt}
                  onChange={(next) => updateAt(idx, next)}
                  placeholder={`set(attributes["langwatch.cost.usd"], attributes["cost_usd"]) where attributes["event.name"] == "api_request"`}
                  error={showError ? status.error : null}
                  errorMessage={errorMessage}
                />
                <IconButton
                  size="xs"
                  variant="ghost"
                  aria-label="Remove statement"
                  onClick={() => removeAt(idx)}
                >
                  <Trash2 size={12} />
                </IconButton>
              </HStack>
              {errorMessage && <ProblemText message={errorMessage} />}
            </Box>
          );
        })}
      </VStack>

      <HStack>
        <Button size="xs" variant="outline" onClick={addEmpty}>
          <Plus size={12} /> Add statement
        </Button>
      </HStack>
    </VStack>
  );
}

function problemOf({
  statement,
  status,
}: {
  statement: string;
  status: PerStatementStatus;
}): string | null {
  return status.error ? describeOttlError({ statement, error: status.error }) : null;
}

/** The plain-language problem, with its backticked code as code chips. */
function ProblemText({ message }: { message: string }) {
  return (
    <Text fontSize="xs" color="fg.error" marginLeft="14px" marginTop={0.5}>
      {message
        .split("`")
        .map((part, i) => (i % 2 === 1 ? <InlineCode key={i}>{part}</InlineCode> : part))}
    </Text>
  );
}

function statementMarkerColor({
  showError,
  isValid,
}: {
  showError: boolean;
  isValid: boolean;
}): string {
  if (showError) return "red.500";
  return isValid ? "green.400" : "border.muted";
}
