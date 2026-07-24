import { Button, Icon, Text, VStack } from "@chakra-ui/react";
import { LuSettings2 } from "react-icons/lu";
import { Checkbox } from "~/components/ui/checkbox";
import {
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Radio, RadioGroup } from "~/components/ui/radio";
import type {
  MarkdownConfig,
  SpanDetailLevel,
  SpanLayout,
  SpanScope,
} from "./types";

export function MarkdownConfigurePopover({
  config,
  onChange,
  placement = "bottom-end",
}: {
  config: MarkdownConfig;
  onChange: (next: MarkdownConfig) => void;
  placement?: "top-start" | "bottom-end";
}) {
  return (
    <PopoverRoot positioning={{ placement }}>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          colorPalette="blue"
          paddingX={2}
          height="24px"
          gap={1}
        >
          <Icon as={LuSettings2} boxSize={3} />
          <Text textStyle="2xs" fontWeight="semibold">
            Configure
          </Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent width="220px">
        <PopoverArrow />
        <PopoverBody padding={2.5}>
          <VStack align="stretch" gap={2.5}>
            <VStack align="stretch" gap={1}>
              <Text
                textStyle="2xs"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="0.06em"
                fontWeight="semibold"
              >
                Sections
              </Text>
              <Checkbox
                size="xs"
                checked={config.includeIO}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeIO: checked === true })
                }
              >
                <Text textStyle="xs">Input / Output</Text>
              </Checkbox>
              <Checkbox
                size="xs"
                checked={config.includeMetadata}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeMetadata: checked === true })
                }
              >
                <Text textStyle="xs">Metadata</Text>
              </Checkbox>
              <Checkbox
                size="xs"
                checked={config.includeSpanIO}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeSpanIO: checked === true })
                }
              >
                <Text textStyle="xs">Per-span input / output</Text>
              </Checkbox>
              <Checkbox
                size="xs"
                checked={config.includeSpanAttributes}
                onCheckedChange={({ checked }) =>
                  onChange({
                    ...config,
                    includeSpanAttributes: checked === true,
                  })
                }
              >
                <Text textStyle="xs">Per-span attributes</Text>
              </Checkbox>
              <Checkbox
                size="xs"
                checked={config.includeWaterfall}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeWaterfall: checked === true })
                }
              >
                <Text textStyle="xs">Unicode waterfall</Text>
              </Checkbox>
              <Checkbox
                size="xs"
                checked={config.includeFlame}
                onCheckedChange={({ checked }) =>
                  onChange({ ...config, includeFlame: checked === true })
                }
              >
                <Text textStyle="xs">Unicode flame graph</Text>
              </Checkbox>
            </VStack>

            <VStack align="stretch" gap={1}>
              <Text
                textStyle="2xs"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="0.06em"
                fontWeight="semibold"
              >
                Spans · scope
              </Text>
              <RadioGroup
                size="xs"
                value={config.spanScope}
                onValueChange={({ value }) =>
                  onChange({ ...config, spanScope: value as SpanScope })
                }
              >
                <VStack align="stretch" gap={1}>
                  <Radio value="none">
                    <Text textStyle="xs">No spans</Text>
                  </Radio>
                  <Radio value="ai">
                    <Text textStyle="xs">AI spans only</Text>
                  </Radio>
                  <Radio value="all">
                    <Text textStyle="xs">All spans</Text>
                  </Radio>
                </VStack>
              </RadioGroup>
            </VStack>

            {config.spanScope !== "none" && (
              <VStack align="stretch" gap={1}>
                <Text
                  textStyle="2xs"
                  color="fg.muted"
                  textTransform="uppercase"
                  letterSpacing="0.06em"
                  fontWeight="semibold"
                >
                  Spans · detail
                </Text>
                <RadioGroup
                  size="xs"
                  value={config.spanDetail}
                  onValueChange={({ value }) =>
                    onChange({
                      ...config,
                      spanDetail: value as SpanDetailLevel,
                    })
                  }
                >
                  <VStack align="stretch" gap={1}>
                    <Radio value="names">
                      <Text textStyle="xs">Names only</Text>
                    </Radio>
                    <Radio value="core">
                      <Text textStyle="xs">+ duration, model, status</Text>
                    </Radio>
                    <Radio value="full">
                      <Text textStyle="xs">+ span IDs, timing</Text>
                    </Radio>
                  </VStack>
                </RadioGroup>
              </VStack>
            )}

            {config.spanScope !== "none" && (
              <VStack align="stretch" gap={1}>
                <Text
                  textStyle="2xs"
                  color="fg.muted"
                  textTransform="uppercase"
                  letterSpacing="0.06em"
                  fontWeight="semibold"
                >
                  Spans · layout
                </Text>
                <RadioGroup
                  size="xs"
                  value={config.spanLayout}
                  onValueChange={({ value }) =>
                    onChange({ ...config, spanLayout: value as SpanLayout })
                  }
                >
                  <VStack align="stretch" gap={1}>
                    <Radio value="tree">
                      <Text textStyle="xs">Tree</Text>
                    </Radio>
                    <Radio value="bullets">
                      <Text textStyle="xs">Bullets</Text>
                    </Radio>
                  </VStack>
                </RadioGroup>
              </VStack>
            )}
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}
