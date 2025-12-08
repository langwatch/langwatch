import {
  Box,
  createListCollection,
  HStack,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { intervalToDuration } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import type { Span, SpanTypes } from "../../server/tracer/types";
import { api } from "../../utils/api";
import { Select } from "../ui/select";

// Invisible UTF-8 character for clean return messages
export const INVISIBLE_RETURN = "​";

type SpanWithChildren = Span & { children: SpanWithChildren[] };

// Available span types for filtering
const spanTypes: SpanTypes[] = [
  "span",
  "agent",
  "llm",
  "tool",
  "chain",
  "rag",
  "guardrail",
  "evaluation",
  "workflow",
  "component",
  "module",
  "server",
  "client",
  "producer",
  "consumer",
  "task",
  "unknown",
];

// Create collection for the multi-select
const spanTypesCollection = createListCollection({
  items: spanTypes.map((type) => ({
    label: type,
    value: type,
  })),
});

// Default selected types (all except 'span')
const defaultSelectedSpanTypes = spanTypes.filter((type) => type !== "span");

/**
 * Build span tree structure from flat spans array
 * Single Responsibility: Transform flat spans array into hierarchical tree structure
 */
const buildTree = (spans: Span[]): Record<string, SpanWithChildren> => {
  const lookup: Record<string, SpanWithChildren> = {};

  spans.forEach((span) => {
    lookup[span.span_id] = { ...span, children: [] };
  });

  spans.forEach((span) => {
    const lookupSpan = lookup[span.span_id];
    if (span.parent_id && lookup[span.parent_id] && lookupSpan) {
      lookup[span.parent_id]?.children.push?.(lookupSpan);
    }
  });

  return lookup;
};

/**
 * Generate participant name for Mermaid diagram
 * Single Responsibility: Create clean participant names for sequence diagram
 */
const getParticipantName = (span: Span): string | null => {
  if (span.type === "agent" && span.name) {
    return span.name
      .replace(".call", "")
      .replace(".run", "")
      .replace("invoke_agent ", "")
      .replace(/[^a-zA-Z0-9]/g, "_");
  }
  if (span.type === "llm" && "model" in span && span.model) {
    return span.model.replace(/[^a-zA-Z0-9]/g, "_").replace(/-/g, "_");
  }
  // Tools cannot be participants, only agents and LLMs can
  if (span.type === "tool") {
    return null;
  }
  // Sanitize all other participant names to avoid Mermaid syntax errors
  return span.name ? span.name.replace(/[^a-zA-Z0-9]/g, "_") : null;
};

/**
 * Generate participant display name for Mermaid diagram
 * Single Responsibility: Create human-readable participant display names
 */
const getParticipantDisplayName = (span: Span): string | null => {
  if (span.type === "agent" && span.name) {
    return span.name
      .replace(".call", "")
      .replace(".run", "")
      .replace("invoke_agent ", "");
  }
  if (span.type === "llm" && "model" in span && span.model) {
    return span.model;
  }
  // Tools cannot be participants, only agents and LLMs can
  if (span.type === "tool") {
    return null;
  }
  return span.name ?? null;
};

/**
 * Format duration in a human-readable way
 * Single Responsibility: Convert millisecond duration to readable format
 */
const formatDuration = (durationMs: number): string => {
  if (durationMs < 1000) return ""; // Don't show durations less than 1s

  // Round to nearest second first, then use intervalToDuration for clean formatting
  const roundedMs = Math.round(durationMs / 1000) * 1000;
  const duration = intervalToDuration({ start: 0, end: roundedMs });

  if ((duration.minutes ?? 0) === 0) {
    // Less than 1 minute, show in seconds
    return ` (${duration.seconds ?? 0}s)`;
  } else {
    // 1 minute or more, show in minutes and seconds
    if ((duration.seconds ?? 0) === 0) {
      return ` (${duration.minutes}min)`;
    } else {
      return ` (${duration.minutes}min ${duration.seconds}s)`;
    }
  }
};

/**
 * Calculate span duration from timestamps
 * Single Responsibility: Get duration in milliseconds from span timestamps
 */
const getSpanDuration = (span: Span): number => {
  if (!span.timestamps?.started_at || !span.timestamps?.finished_at) {
    return 0;
  }
  return span.timestamps.finished_at - span.timestamps.started_at;
};

/**
 * Generate Mermaid sequence diagram syntax from spans
 * Single Responsibility: Convert span tree into Mermaid sequence diagram syntax
 */
export const generateMermaidSyntax = (
  spans: Span[],
  includedSpanTypes?: SpanTypes[],
): string => {
  // Filter spans based on included types (default to all types except 'span')
  const typesToInclude = includedSpanTypes ?? defaultSelectedSpanTypes;

  // Build tree from ALL spans to preserve relationships
  const tree = buildTree(spans);

  // Helper function to find the next included descendant(s) of a span
  const findIncludedDescendants = (
    span: SpanWithChildren,
  ): SpanWithChildren[] => {
    const descendants: SpanWithChildren[] = [];

    const traverse = (currentSpan: SpanWithChildren) => {
      if (typesToInclude.includes(currentSpan.type)) {
        descendants.push(currentSpan);
      } else {
        // If this span is filtered out, check its children
        currentSpan.children.forEach((child) => traverse(child));
      }
    };

    span.children.forEach((child) => traverse(child));
    return descendants;
  };
  const participants = new Set<string>();
  const participantDisplayNames = new Map<string, string>();
  const participantTypes = new Map<string, string>(); // Track whether it's an agent or LLM
  const messages: string[] = [];

  // Only collect participants from included spans
  const includedSpans = spans.filter((span) =>
    typesToInclude.includes(span.type),
  );

  // Sort included spans by start time to maintain chronological order
  const sortedSpans = [...includedSpans].sort(
    (a, b) => a.timestamps.started_at - b.timestamps.started_at,
  );

  // Collect all participants first
  sortedSpans.forEach((span) => {
    const participantName = getParticipantName(span);
    const displayName = getParticipantDisplayName(span);
    if (participantName && displayName) {
      participants.add(participantName);
      participantDisplayNames.set(participantName, displayName);
      participantTypes.set(participantName, span.type); // Store the original span type
    }
  });

  // Helper function to recursively check if a span has any included descendants
  const hasIncludedDescendants = (span: SpanWithChildren): boolean => {
    if (!span.children || span.children.length === 0) {
      return false;
    }

    // Check if any direct children are included
    for (const child of span.children) {
      if (typesToInclude.includes(child.type)) {
        return true;
      }
      // Recursively check grandchildren
      if (hasIncludedDescendants(child)) {
        return true;
      }
    }

    return false;
  };

  // Generate interactions with bridging logic for filtered spans
  const processedSpans = new Set<string>();

  const processSpan = (span: SpanWithChildren, parentParticipant?: string) => {
    if (processedSpans.has(span.span_id)) return;
    processedSpans.add(span.span_id);

    const currentParticipant = getParticipantName(span);
    const isCurrentIncluded = typesToInclude.includes(span.type);

    // If current span is included, process it normally
    if (isCurrentIncluded) {
      // Handle tool spans as self-calls to their parent LLM
      if (span.type === "tool" && parentParticipant && span.name) {
        messages.push(
          `    ${parentParticipant}->>${parentParticipant}: tool: ${span.name}`,
        );
        // Process tool's children (like agents called by the tool)
        span.children
          .sort((a, b) => a.timestamps.started_at - b.timestamps.started_at)
          .forEach((child) => {
            processSpan(child, parentParticipant);
          });
        return;
      }

      // If this span has a participant and a parent participant, create an interaction
      if (
        currentParticipant &&
        parentParticipant &&
        currentParticipant !== parentParticipant
      ) {
        let label = (span.name ?? span.type).slice(0, 50);

        // Special handling for different span types
        if (span.type === "llm") {
          label = "LLM call";
        } else if (span.type === "agent") {
          if (participantTypes.get(parentParticipant) === "agent") {
            label = "handover";
          } else {
            label = "call";
          }
        }

        // Add duration if significant (>1s) and it's an effective leaf node (no included descendants)
        const duration = getSpanDuration(span);
        const isEffectiveLeafNode = !hasIncludedDescendants(span);
        if (isEffectiveLeafNode) {
          label += formatDuration(duration);
        }

        // Add error indicator if span has error
        if (span.error) {
          label += " (error)";
        }

        // Create the call message
        messages.push(
          `    ${parentParticipant}->>${currentParticipant}: ${label}`,
        );

        // Activate the target participant
        messages.push(`    activate ${currentParticipant}`);
      }

      // Process children normally
      const nextParent = currentParticipant ?? parentParticipant;
      span.children
        .sort((a, b) => a.timestamps.started_at - b.timestamps.started_at)
        .forEach((child) => {
          processSpan(child, nextParent);
        });

      // Create return message and deactivate when span completes
      if (
        currentParticipant &&
        parentParticipant &&
        currentParticipant !== parentParticipant
      ) {
        // Create a return message with invisible character
        messages.push(
          `    ${currentParticipant}-->>${parentParticipant}: ${INVISIBLE_RETURN}`,
        );

        // Deactivate the current participant
        messages.push(`    deactivate ${currentParticipant}`);
      }
    } else {
      // Current span is filtered out - bridge to its included descendants
      const includedDescendants = findIncludedDescendants(span);

      includedDescendants
        .sort((a, b) => a.timestamps.started_at - b.timestamps.started_at)
        .forEach((descendant) => {
          processSpan(descendant, parentParticipant);
        });
    }
  };

  // Find root spans from all spans (no parent or parent not in spans)
  const allSpanMap = new Map(spans.map((span) => [span.span_id, span]));
  const rootSpans = spans.filter(
    (s) => !s.parent_id || !allSpanMap.has(s.parent_id),
  );

  // Process each root span
  rootSpans
    .sort((a, b) => a.timestamps.started_at - b.timestamps.started_at)
    .forEach((rootSpan) => {
      const span = tree[rootSpan.span_id];
      if (span) {
        processSpan(span);
      }
    });

  // Build the final Mermaid syntax
  let mermaidSyntax = "sequenceDiagram\n";

  // Add actors/participants with display names
  participants.forEach((participant) => {
    const displayName = participantDisplayNames.get(participant);
    const participantType = participantTypes.get(participant);
    // Use "actor" for agents, "participant" for LLMs
    const keyword = participantType === "agent" ? "actor" : "participant";
    mermaidSyntax += `    ${keyword} ${participant} as ${displayName}\n`;
  });

  // Add messages
  messages.forEach((message) => {
    mermaidSyntax += `${message}\n`;
  });

  console.log("mermaidSyntax", mermaidSyntax);

  return mermaidSyntax;
};

/**
 * Mermaid Sequence Diagram Renderer
 * Single Responsibility: Render Mermaid sequence diagram from syntax
 */
const MermaidRenderer = ({ syntax }: { syntax: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const loadMermaid = async () => {
      if (!containerRef.current || !syntax || isLoaded) return;

      try {
        // Dynamic import to avoid SSR issues
        const mermaid = (await import("mermaid")).default;

        // Initialize mermaid with configuration
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            // Modern color scheme
            primaryColor: "#F7FAFC", // Light light gray background for boxes
            primaryTextColor: "#1A202C", // Dark text
            primaryBorderColor: "#E2E8F0", // Light gray border
            lineColor: "#4A5568", // Darker gray for lines
            secondaryColor: "#F7FAFC", // Light light gray
            tertiaryColor: "#EDF2F7",
            // Actor (agent) styling - light light gray
            actorBkg: "#F7FAFC",
            actorBorder: "#D2D8E0",
            actorTextColor: "#2D3748",
            // Participant (LLM) styling - light light gray
            participantBkg: "#F7FAFC",
            participantBorder: "#E2E8F0",
            participantTextColor: "#2D3748",
            // Labels
            labelTextColor: "#2D3748",
            labelBoxBkgColor: "#FFFFFF",
            labelBoxBorderColor: "#E2E8F0",
            // Signal (message) colors
            signalColor: "#2D3748",
            signalTextColor: "#2D3748",
            // Activation boxes - light blue
            activationBkgColor: "#DBEAFE",
            activationBorderColor: "#60A5FA",
            // Font
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
            fontSize: "14px",
          },
          sequence: {
            diagramMarginX: 50,
            diagramMarginY: 50,
            actorMargin: 50,
            width: 150,
            height: 65,
            boxMargin: 10,
            boxTextMargin: 5,
            noteMargin: 10,
            messageMargin: 35,
            mirrorActors: true,
            bottomMarginAdj: 16,
            useMaxWidth: true,
            rightAngles: false,
            showSequenceNumbers: false,
          },
        });

        // Clear the container
        containerRef.current.innerHTML = "";

        // Generate unique ID for this diagram
        const id = `mermaid-${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        // Render the diagram
        const { svg } = await mermaid.render(id, syntax);

        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          setIsLoaded(true);
        }
      } catch (error) {
        console.error("Error rendering Mermaid diagram:", error);
        if (containerRef.current) {
          containerRef.current.innerHTML = `
            <div style="padding: 20px; text-align: center; color: #666;">
              <p>Error rendering sequence diagram</p>
              <pre style="font-size: 12px; margin-top: 10px;">${String(
                error,
              )}</pre>
            </div>
          `;
        }
      }
    };

    void loadMermaid();
  }, [syntax, isLoaded]);

  // Reset when syntax changes
  useEffect(() => {
    setIsLoaded(false);
  }, [syntax]);

  return (
    <Box
      ref={containerRef}
      width="full"
      minHeight="200px"
      display="flex"
      alignItems="center"
      justifyContent="center"
    />
  );
};

/**
 * Main Sequence Diagram component
 * Single Responsibility: Render sequence diagram from span data
 */
const SequenceDiagram = ({
  spans,
  selectedSpanTypes,
}: {
  spans: Span[];
  selectedSpanTypes: SpanTypes[];
}) => {
  const mermaidSyntax = useMemo(() => {
    if (!spans || spans.length === 0) return "";

    return generateMermaidSyntax(spans, selectedSpanTypes);
  }, [spans, selectedSpanTypes]);

  if (!mermaidSyntax) {
    return (
      <Box padding={8} textAlign="center" color="gray.500">
        No agent or LLM interactions found in this trace.
      </Box>
    );
  }

  return (
    <VStack align="start" width="full" gap={4}>
      <Box
        width="full"
        background="white"
        borderRadius="md"
        padding={4}
        boxShadow="sm"
      >
        <MermaidRenderer syntax={mermaidSyntax} />
      </Box>

      <Box
        as="details"
        width="full"
        background="white"
        borderRadius="md"
        padding={4}
        boxShadow="sm"
      >
        <Box as="summary" cursor="pointer" color="gray.500" fontSize="sm">
          Show Mermaid Syntax
        </Box>
        <Box
          as="pre"
          fontSize="xs"
          background="gray.50"
          padding={4}
          marginTop={4}
          borderRadius="md"
          overflow="auto"
        >
          {mermaidSyntax}
        </Box>
      </Box>
    </VStack>
  );
};

type SequenceDiagramProps = {
  traceId: string;
};

/**
 * Count unique participants in spans for given span types
 * Single Responsibility: Calculate number of participants that would be rendered
 */
const countParticipants = (
  spans: Span[],
  includedTypes: SpanTypes[],
): number => {
  const participants = new Set<string>();
  spans
    .filter((span) => includedTypes.includes(span.type))
    .forEach((span) => {
      const participantName = getParticipantName(span);
      if (participantName) {
        participants.add(participantName);
      }
    });
  return participants.size;
};

/**
 * SequenceDiagramContainer component that handles data fetching
 * Single Responsibility: Manage data fetching and state for the sequence diagram
 */
export function SequenceDiagramContainer(props: SequenceDiagramProps) {
  const { traceId, trace } = useTraceDetailsState(props.traceId);
  const { project } = useOrganizationTeamProject();
  const [selectedSpanTypes, setSelectedSpanTypes] = useState<SpanTypes[]>(
    defaultSelectedSpanTypes,
  );

  const [keepRefetching, setKeepRefetching] = useState(false);
  const spans = api.spans.getAllForTrace.useQuery(
    { projectId: project?.id ?? "", traceId: traceId ?? "" },
    {
      enabled: !!project && !!traceId,
      refetchOnWindowFocus: false,
      refetchInterval: keepRefetching ? 1_000 : undefined,
    },
  );

  // Auto-include "span" types if there are too few participants
  useEffect(() => {
    if (!spans.data || spans.data.length === 0) return;

    // Count participants with default selection (without "span")
    const participantCount = countParticipants(
      spans.data,
      defaultSelectedSpanTypes,
    );

    // If 2 or fewer participants, automatically include "span" type
    if (participantCount <= 2 && !selectedSpanTypes.includes("span")) {
      setSelectedSpanTypes([...defaultSelectedSpanTypes, "span"]);
    }
  }, [spans.data]);

  useEffect(() => {
    if ((trace.data?.timestamps.inserted_at ?? 0) < Date.now() - 10 * 1000) {
      return;
    }

    setKeepRefetching(true);
    const timeout = setTimeout(() => {
      setKeepRefetching(false);
    }, 10_000);
    return () => clearTimeout(timeout);
  }, [trace.data?.timestamps.inserted_at]);

  if (!trace.data || !spans.data) {
    return null;
  }

  return (
    <VStack align="start" width="full" gap={4} paddingX={4}>
      <Select.Root
        multiple
        collection={spanTypesCollection}
        size="sm"
        value={selectedSpanTypes}
        onValueChange={(details) =>
          setSelectedSpanTypes(details.value as SpanTypes[])
        }
      >
        <Select.HiddenSelect />
        <HStack width="full">
          <Spacer />
          <Select.Label>Include span types:</Select.Label>
          <Select.Control width="120px" background="white">
            <Select.Trigger>
              <Select.ValueText placeholder="Select span types" />
            </Select.Trigger>
            <Select.IndicatorGroup>
              <Select.Indicator />
            </Select.IndicatorGroup>
          </Select.Control>
          <Select.Content zIndex="popover">
            {spanTypesCollection.items.map((spanType) => (
              <Select.Item item={spanType} key={spanType.value}>
                {spanType.label}
              </Select.Item>
            ))}
          </Select.Content>
        </HStack>
      </Select.Root>

      <SequenceDiagram
        spans={spans.data}
        selectedSpanTypes={selectedSpanTypes}
      />
    </VStack>
  );
}
