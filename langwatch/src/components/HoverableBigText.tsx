import {
  Box,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
  ModalContent,
  ModalOverlay,
  Modal,
  Tooltip,
  type BoxProps,
  Switch,
  HStack,
  Text,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useWorkflowStore } from "../optimization_studio/hooks/useWorkflowStore";
import remarkGfm from "remark-gfm";
import Markdown from "react-markdown";

export function ExpandedTextModal() {
  const { textExpanded, setTextExpanded } = useWorkflowStore((state) => ({
    textExpanded: state.textExpanded,
    setTextExpanded: state.setTextExpanded,
  }));

  const [isFormatted, setIsFormatted] = useState(true);

  return (
    <Modal
      isOpen={!!textExpanded}
      onClose={() => setTextExpanded(undefined)}
      size="4xl"
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader
          background="gray.100"
          padding={3}
          borderRadius="12px 12px 0 0"
          fontSize="14px"
        >
          <HStack>
            <Switch
              size="sm"
              isChecked={isFormatted}
              onChange={() => setIsFormatted(!isFormatted)}
            />
            <Text>Formatted</Text>
          </HStack>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody paddingY={6} paddingX={8}>
          {textExpanded && isFormatted ? (
            <Markdown remarkPlugins={[remarkGfm]} className="markdown">
              {textExpanded}
            </Markdown>
          ) : textExpanded ? (
            <Box whiteSpace="pre-wrap" fontFamily="mono">
              {textExpanded}
            </Box>
          ) : null}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export function HoverableBigText({ children, ...props }: BoxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflown, setIsOverflown] = useState(false);
  const { setTextExpanded } = useWorkflowStore((state) => ({
    setTextExpanded: state.setTextExpanded,
  }));

  useEffect(() => {
    const element = ref.current!;

    const checkOverflow = () => {
      setIsOverflown(
        element
          ? Math.abs(element.offsetWidth - element.scrollWidth) > 2 ||
              Math.abs(element.offsetHeight - element.scrollHeight) > 2
          : false
      );
    };

    checkOverflow();
    window.addEventListener("resize", checkOverflow);

    return () => {
      window.removeEventListener("resize", checkOverflow);
    };
  }, []);

  return (
    <Tooltip
      isDisabled={!isOverflown}
      label={
        <Box whiteSpace="pre-wrap">
          [click anywhere to enlarge]{"\n"}
          {typeof children === "string"
            ? children.slice(0, 2000) + (children.length > 2000 ? "..." : "")
            : children}
        </Box>
      }
    >
      <Box
        ref={ref}
        width="full"
        height="full"
        whiteSpace="normal"
        noOfLines={7}
        {...props}
        {...(isOverflown && {
          onClick: () => setTextExpanded(children as string),
        })}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
