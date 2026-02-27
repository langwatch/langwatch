import { Box, Text, HStack, Badge, Collapse, useDisclosure } from "@chakra-ui/react";
import { ChevronRightIcon, ChevronDownIcon, CloseIcon } from "@chakra-ui/icons";
import type { PipelineNode } from "../../../shared/types.ts";

/** Collect all leaf pipeline names under a node */
function collectLeafNames(node: PipelineNode): string[] {
  if (node.children.length === 0) return [node.name];
  return node.children.flatMap(collectLeafNames);
}

interface TreeNodeProps {
  node: PipelineNode;
  depth?: number;
  selectedPipeline: string | null;
  onSelectPipeline: (name: string | null) => void;
}

function TreeNode({ node, depth = 0, selectedPipeline, onSelectPipeline }: TreeNodeProps) {
  const { isOpen, onToggle } = useDisclosure({ defaultIsOpen: false });
  const hasChildren = node.children.length > 0;

  const leafNames = collectLeafNames(node);
  const isSelected = selectedPipeline !== null && leafNames.includes(selectedPipeline);
  const isExactSelected = selectedPipeline === node.name;

  const handleClick = () => {
    if (hasChildren) {
      onToggle();
    } else {
      onSelectPipeline(isExactSelected ? null : node.name);
    }
  };

  return (
    <Box>
      <HStack
        px={3}
        py={0.5}
        pl={`${depth * 16 + 12}px`}
        cursor="pointer"
        onClick={handleClick}
        _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}
        borderRadius="2px"
        borderLeft={depth > 0 ? "1px solid rgba(0, 240, 255, 0.1)" : "none"}
        bg={isExactSelected ? "rgba(0, 240, 255, 0.08)" : isSelected ? "rgba(0, 240, 255, 0.03)" : "transparent"}
        transition="background-color 0.2s"
      >
        {hasChildren && (
          <Box color="#00f0ff" fontSize="xs">
            {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </Box>
        )}
        <Text
          fontSize="xs"
          fontFamily="mono"
          color={isExactSelected ? "#00f0ff" : depth === 0 ? "#00f0ff" : "#6a8a9a"}
          textTransform={depth === 0 ? "uppercase" : "none"}
          fontWeight={isExactSelected ? "600" : "normal"}
        >
          {node.name}
        </Text>
        {!hasChildren && (
          <Text fontSize="9px" color="#4a6a7a" opacity={isExactSelected ? 1 : 0} transition="opacity 0.2s">
            FILTER
          </Text>
        )}
        <HStack spacing={1} ml="auto">
          {node.pending > 0 && (
            <Badge bg="rgba(0, 240, 255, 0.1)" color="#00f0ff" fontSize="10px" borderRadius="2px">
              {node.pending} pending
            </Badge>
          )}
          {node.active > 0 && (
            <Badge bg="rgba(0, 255, 65, 0.12)" color="#00ff41" fontSize="10px" borderRadius="2px">
              {node.active} active
            </Badge>
          )}
          {node.blocked > 0 && (
            <Badge bg="rgba(255, 0, 51, 0.15)" color="#ff0033" fontSize="10px" borderRadius="2px">
              {node.blocked} blocked
            </Badge>
          )}
        </HStack>
      </HStack>
      {hasChildren && (
        <Collapse in={isOpen} animateOpacity>
          {node.children.map((child) => (
            <TreeNode
              key={child.name}
              node={child}
              depth={depth + 1}
              selectedPipeline={selectedPipeline}
              onSelectPipeline={onSelectPipeline}
            />
          ))}
        </Collapse>
      )}
    </Box>
  );
}

interface PipelineTreeProps {
  nodes: PipelineNode[];
  selectedPipeline: string | null;
  onSelectPipeline: (name: string | null) => void;
}

export function PipelineTree({ nodes, selectedPipeline, onSelectPipeline }: PipelineTreeProps) {
  return (
    <Box
      bg="#0a0e17"
      borderRadius="2px"
      border="1px solid"
      borderColor="rgba(0, 240, 255, 0.15)"
      boxShadow="0 0 8px rgba(0, 240, 255, 0.08)"
      py={1}
      h="100%"
    >
      <HStack px={4} py={1}>
        <Text
          fontSize="xs"
          color="#00f0ff"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.15em"
        >
          // Pipeline Breakdown
        </Text>
        {selectedPipeline && (
          <HStack
            spacing={1}
            ml={3}
            px={2}
            py={0.5}
            bg="rgba(0, 240, 255, 0.08)"
            border="1px solid rgba(0, 240, 255, 0.2)"
            borderRadius="2px"
            cursor="pointer"
            onClick={() => onSelectPipeline(null)}
            _hover={{ borderColor: "#00f0ff" }}
          >
            <Text fontSize="10px" color="#00f0ff" fontFamily="mono">{selectedPipeline}</Text>
            <CloseIcon boxSize="8px" color="#4a6a7a" />
          </HStack>
        )}
      </HStack>
      {nodes.length === 0 ? (
        <Text fontSize="xs" color="#4a6a7a" px={4} py={3} textTransform="uppercase" letterSpacing="0.1em">
          Discovering pipelines...
        </Text>
      ) : (
        nodes.map((node) => (
          <TreeNode
            key={node.name}
            node={node}
            selectedPipeline={selectedPipeline}
            onSelectPipeline={onSelectPipeline}
          />
        ))
      )}
    </Box>
  );
}
