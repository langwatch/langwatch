/**
 * Resource-result capability card — the write/read fall-throughs that don't
 * have a bespoke card of their own:
 *
 *   - resourceCreated → green "New <resource>" with the saved name and an
 *     "Open in <surface>" link (the applied half of propose-then-apply, for a
 *     create that ran directly rather than being staged as a proposal).
 *   - resourceUpdated → green "Update <resource>".
 *   - resourceRemoved → red "Delete <resource>", linking to the surface index
 *     (the resource itself is gone, so no per-resource deep link).
 *   - resourceRead   → a compact summary of a generic list/get.
 *   - promptDiff     → the updated prompt content in a mono block.
 *
 * Staged, not-yet-applied writes still ride ProposalCard (Apply / Discard) and
 * confirm-gated deletes still ride its red variant — this card is the executed
 * result, never the gate.
 */
import { Box, Text, VStack } from "@chakra-ui/react";
import {
  extractPrimaryId,
  extractResourceName,
  extractToolText,
  summaryLines,
  type CapabilityCardInput,
} from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";

function promptContent(input: unknown, output: unknown): string | null {
  for (const source of [input, output]) {
    if (!source || typeof source !== "object") continue;
    const obj = source as Record<string, unknown>;
    if (typeof obj.prompt === "string" && obj.prompt.trim()) return obj.prompt;
    if (typeof obj.content === "string" && obj.content.trim())
      return obj.content;
    if (Array.isArray(obj.messages)) {
      const joined = obj.messages
        .map((m) =>
          m && typeof m === "object"
            ? `${(m as { role?: string }).role ?? ""}: ${
                (m as { content?: string }).content ?? ""
              }`.trim()
            : "",
        )
        .filter(Boolean)
        .join("\n");
      if (joined) return joined;
    }
  }
  return null;
}

export function LangyResourceResultCard({
  descriptor,
  input,
  output,
  projectSlug,
}: CapabilityCardInput) {
  const name = extractResourceName(input, output);
  const id = extractPrimaryId(input, output);

  if (descriptor.render === "promptDiff") {
    const content = promptContent(input, output);
    return (
      <LangyCapabilityCard
        tone="updated"
        surface="prompts"
        overline={descriptor.overline}
        title={name ?? "Prompt updated"}
        projectSlug={projectSlug}
        resourceId={id}
      >
        <Text textStyle="2xs" color="fg.muted">
          New version
        </Text>
        {content ? (
          <Box
            as="pre"
            textStyle="2xs"
            fontFamily="mono"
            color="fg"
            background="bg.muted"
            borderWidth="1px"
            borderStyle="solid"
            borderColor="border.muted"
            borderRadius="sm"
            padding={2}
            margin={0}
            maxHeight="160px"
            overflowY="auto"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
          >
            {content}
          </Box>
        ) : (
          <Text textStyle="xs" color="fg.muted">
            Prompt updated.
          </Text>
        )}
      </LangyCapabilityCard>
    );
  }

  if (descriptor.render === "resourceRemoved") {
    return (
      <LangyCapabilityCard
        tone="removed"
        surface={descriptor.surface}
        overline={descriptor.overline}
        title={name ?? "Removed"}
        projectSlug={projectSlug}
        // Resource is gone — link to the surface index, not a dead detail page.
        resourceId={null}
      >
        <Text textStyle="xs" color="fg.muted">
          Removed from this project.
        </Text>
      </LangyCapabilityCard>
    );
  }

  if (
    descriptor.render === "resourceCreated" ||
    descriptor.render === "resourceUpdated"
  ) {
    const created = descriptor.render === "resourceCreated";
    return (
      <LangyCapabilityCard
        tone={created ? "created" : "updated"}
        surface={descriptor.surface}
        overline={descriptor.overline}
        title={name ?? (created ? "Created" : "Updated")}
        projectSlug={projectSlug}
        resourceId={id}
      >
        <Text textStyle="xs" color="fg.muted">
          {created ? "Created and ready to use." : "Saved."}
        </Text>
      </LangyCapabilityCard>
    );
  }

  // resourceRead — a generic list/get with no bespoke card.
  const lines = summaryLines(output, 3);
  const isEmpty = extractToolText(output).trim().length === 0;
  return (
    <LangyCapabilityCard
      tone="read"
      surface={descriptor.surface}
      overline={descriptor.overline}
      title={name ?? descriptor.overline}
      projectSlug={projectSlug}
      resourceId={id}
    >
      {lines.length > 0 ? (
        <VStack align="stretch" gap={0.5}>
          {lines.map((line, i) => (
            <Text key={i} textStyle="xs" color="fg.muted" lineHeight="1.45">
              {line}
            </Text>
          ))}
        </VStack>
      ) : isEmpty ? null : (
        <Text textStyle="xs" color="fg.muted">
          Done.
        </Text>
      )}
    </LangyCapabilityCard>
  );
}
