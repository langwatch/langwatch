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
 * parser. Per-statement errors render inline with line/col coordinates.
 *
 * Spec: specs/ai-governance/ingestion-sources/claude-code-otlp.feature
 */
import {
  Box,
  Button,
  HStack,
  IconButton,
  Spacer,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { FileText, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { HandledErrorAlert } from "~/features/errors";
import { api } from "~/utils/api";

interface OttlEditorProps {
  organizationId: string;
  sourceType: string;
  statements: string[];
  onChange: (next: string[]) => void;
  /** Whether to render the editor at all. Caller can hide for source
   *  types that don't accept OTTL (pull-mode adapters etc.). */
  enabled: boolean;
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
  message: string | null;
}

const VALIDATE_DEBOUNCE_MS = 600;

/** Shared because they are immutable and never rendered per-index. */
const UNKNOWN_STATUS: PerStatementStatus = {
  validity: "unknown",
  message: null,
};
const VALID_STATUS: PerStatementStatus = { validity: "valid", message: null };

export function OttlEditor({
  organizationId,
  sourceType,
  statements,
  onChange,
  enabled,
}: OttlEditorProps) {
  const [validationStatus, setValidationStatus] = useState<
    PerStatementStatus[]
  >([]);
  const [validating, setValidating] = useState(false);
  /** The failure that stopped validation running at all, if any. */
  const [validationError, setValidationError] = useState<unknown>(null);

  const starterQuery = api.ingestionSources.ottlStarter.useQuery(
    { organizationId, sourceType },
    {
      enabled: enabled && !!organizationId && !!sourceType,
      refetchOnWindowFocus: false,
    },
  );

  const starterStatements = starterQuery.data?.statements;

  const validateMutation = api.ingestionSources.validateOttl.useMutation();

  const triggerValidation = useCallback(
    async (next: string[]) => {
      const nonEmpty = next.filter((s) => s.trim().length > 0);
      if (nonEmpty.length === 0) {
        setValidationError(null);
        setValidationStatus(next.map(() => UNKNOWN_STATUS));
        return;
      }
      setValidating(true);
      try {
        const result = await validateMutation.mutateAsync({
          organizationId,
          statements: next,
        });
        setValidationError(null);
        if (result.ok) {
          setValidationStatus(next.map(() => VALID_STATUS));
        } else {
          const errsByIdx = new Map<number, string>();
          for (const err of result.errors) {
            const where =
              err.line > 0 ? ` (line ${err.line}, col ${err.col})` : "";
            errsByIdx.set(err.statementIndex, `${err.message}${where}`);
          }
          setValidationStatus(
            next.map((_, idx): PerStatementStatus => {
              const msg = errsByIdx.get(idx);
              return msg ? { validity: "invalid", message: msg } : VALID_STATUS;
            }),
          );
        }
      } catch (err) {
        // The check didn't run — the gateway is unreachable, or the request
        // failed on the way there. Don't block save, but don't claim a
        // result either: every statement goes back to `unknown` (neutral
        // dot, no green) and the reason renders once, above the list.
        setValidationError(err);
        setValidationStatus(next.map(() => UNKNOWN_STATUS));
      } finally {
        setValidating(false);
      }
    },
    [organizationId, validateMutation],
  );

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
  const matchesStarter = useMemo(() => {
    if (!starterStatements || starterStatements.length === 0) return false;
    if (starterStatements.length !== statements.length) return false;
    for (let i = 0; i < starterStatements.length; i++) {
      if ((starterStatements[i] ?? "") !== (statements[i] ?? "")) return false;
    }
    return true;
  }, [starterStatements, statements]);

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
            <code>langwatch.*</code> namespace. The aigateway evaluates them in
            order via embedded <code>pkg/ottl</code>.
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
          backgroundColor="orange.50"
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
                Loads the canonical extraction statements maintained by
                LangWatch. You can customize them after loading.
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
      <HandledErrorAlert
        error={validationError}
        fallbackTitle="Couldn't check these statements"
      />

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
                  backgroundColor={
                    showError
                      ? "red.500"
                      : isWritten && status?.validity === "valid"
                        ? "green.400"
                        : "border.muted"
                  }
                  flexShrink={0}
                />
                <Textarea
                  size="sm"
                  rows={2}
                  fontFamily="mono"
                  fontSize="xs"
                  backgroundColor="white"
                  value={stmt}
                  onChange={(e) => updateAt(idx, e.target.value)}
                  placeholder={`set(attributes["langwatch.cost.usd"], attributes["cost_usd"]) where attributes["event.name"] == "api_request"`}
                  borderColor={showError ? "red.300" : undefined}
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
              {showError && (
                <Text
                  fontSize="xs"
                  color="red.600"
                  marginLeft="14px"
                  marginTop={0.5}
                >
                  {status.message}
                </Text>
              )}
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
