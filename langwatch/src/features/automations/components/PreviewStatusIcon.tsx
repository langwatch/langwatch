import { Box, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import type { PreviewEnvelope } from "~/automations/providers/types";

/**
 * Status pip rendered next to the "Preview" heading. The full preview
 * panel (rendered email iframe / Slack chrome / variable reference /
 * example data) was traded for this single icon — much of that surface
 * was framework-default boilerplate the author can't act on. The pip
 * tells the author whether the preview rendered cleanly; the tooltip
 * lists any warnings the renderer reported (Liquid syntax errors,
 * missing variables, fallback to the framework default).
 */
export function PreviewStatusIcon({
  preview,
  loading,
}: {
  preview: PreviewEnvelope | undefined;
  loading: boolean | undefined;
}) {
  if (loading) {
    return (
      <Box
        as="span"
        color="fg.muted"
        display="inline-flex"
        alignItems="center"
      >
        <Loader2 size={13} />
      </Box>
    );
  }

  if (!preview) {
    return (
      <Tooltip
        openDelay={200}
        content={
          <Text textStyle="xs">
            Edit a template and a preview will render against example trigger
            data. Warnings from the renderer surface here.
          </Text>
        }
      >
        <Box
          as="span"
          color="fg.muted"
          cursor="help"
          display="inline-flex"
          alignItems="center"
        >
          <Info size={13} />
        </Box>
      </Tooltip>
    );
  }

  const hasErrors = preview.errors.length > 0;
  const hasMissing = preview.missingVariables.length > 0;
  const hasWarning = hasErrors || hasMissing || preview.usedDefault;

  const Icon = hasWarning ? AlertTriangle : CheckCircle2;
  const color = hasWarning ? "fg.warning" : "fg.success";

  return (
    <Tooltip
      openDelay={200}
      content={
        <VStack align="stretch" gap={1} padding={1}>
          {hasErrors ? (
            <Text textStyle="xs">
              Fell back to the default template: {preview.errors.join("; ")}
            </Text>
          ) : preview.usedDefault ? (
            <Text textStyle="xs">
              Rendered with the framework default template.
            </Text>
          ) : (
            <Text textStyle="xs">Renders cleanly.</Text>
          )}
          {hasMissing ? (
            <Text textStyle="xs">
              Missing variables rendered empty:{" "}
              {preview.missingVariables.join(", ")}
            </Text>
          ) : null}
        </VStack>
      }
    >
      <Box
        as="span"
        color={color}
        cursor="help"
        display="inline-flex"
        alignItems="center"
      >
        <Icon size={13} />
      </Box>
    </Tooltip>
  );
}
