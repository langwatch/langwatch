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
  VStack,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import Markdown from "react-markdown";
import { isJson } from "../utils/isJson";
import { RenderInputOutput } from "./traces/RenderInputOutput";

export function ExpandedTextModal({
  isOpen,
  onClose,
  textExpanded,
}: {
  isOpen: boolean;
  onClose: () => void;
  textExpanded: string | undefined;
}) {
  const [isFormatted, setIsFormatted] = useState(true);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="4xl">
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
          {isOpen && textExpanded && isFormatted ? (
            isJson(textExpanded) ? (
              <RenderInputOutput value={textExpanded} showTools={"copy-only"} />
            ) : (
              <Markdown remarkPlugins={[remarkGfm]} className="markdown">
                {typeof textExpanded === "string"
                  ? textExpanded
                  : JSON.stringify(textExpanded, null, 2)}
              </Markdown>
            )
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

export function HoverableBigText({
  children,
  expandedVersion,
  expandable = true,
  ...props
}: BoxProps & { expandedVersion?: string; expandable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflown, setIsOverflown] = useState(false);
  const [textExpanded, setTextExpanded] = useState<string | undefined>(
    undefined
  );
  const expandedVersion_ = expandedVersion ?? children;

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
    <>
      <Tooltip
        isDisabled={!isOverflown}
        label={
          <VStack padding={0} spacing={0} width="full" display="block">
            {expandable && (
              <Text
                textAlign="center"
                background="black"
                width="calc(100% + 16px)"
                marginLeft="-8px"
                marginTop="-4px"
              >
                click anywhere to enlarge
              </Text>
            )}
            <Box whiteSpace="pre-wrap">
              <center></center>
              {typeof expandedVersion_ === "string"
                ? expandedVersion_.slice(0, 2000) +
                  (expandedVersion_.length > 2000 ? "..." : "")
                : expandedVersion_}
            </Box>
          </VStack>
        }
      >
        <Box
          ref={ref}
          width="full"
          height="full"
          whiteSpace="normal"
          noOfLines={7}
          {...props}
          {...(isOverflown &&
            expandable && {
              onClick: (e) => {
                e.stopPropagation();
                setTextExpanded(expandedVersion_ as string);
              },
            })}
        >
          {children}
        </Box>
      </Tooltip>
      <ExpandedTextModal
        isOpen={!!textExpanded}
        onClose={() => setTextExpanded(undefined)}
        textExpanded={textExpanded}
      />
    </>
  );
}
