// The condition, checked as it is typed: a refusal underlines where it starts and says the fix,
// and an attribute the owner's spans carry is inserted at the cursor with the caret in its quotes.

import type { BraidConditionCompileResult } from "@langwatch/authz-contract";
import { Menu } from "@langwatch/design-system/menu";
import {
  Box,
  Button,
  Code,
  Field,
  HStack,
  Stack,
  Text,
  Textarea,
} from "@langwatch/design-system/primitives";
import { AlertTriangle, CheckCircle2, ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { insertAttribute } from "../../../../model/braids/braid-draft.ts";

export type BraidConditionFieldProps = {
  value: string;
  onChange: (value: string) => void;
  check: BraidConditionCompileResult;
  ownerName: string;
  readerName: string;
  verified: boolean;
  attributeKeys: readonly { key: string; spanCount: number }[];
};

/** The text with the refused construct underlined from its offset to the next space. */
function RefusedText({ text, at }: { text: string; at: number }) {
  const end = Math.max(
    at + 1,
    text.slice(at).search(/\s/) === -1 ? text.length : at + text.slice(at).search(/\s/),
  );
  return (
    <Code
      display="block"
      whiteSpace="pre-wrap"
      fontVariantLigatures="none"
      fontSize="sm"
      padding={2}
      data-testid="braid-condition-refused"
    >
      {text.slice(0, at)}
      <Box
        as="mark"
        bg="transparent"
        color="red.fg"
        textDecoration="underline wavy"
        textDecorationColor="red.fg"
      >
        {text.slice(at, end) || " "}
      </Box>
      {text.slice(end)}
    </Code>
  );
}

function CheckLine({
  check,
  empty,
  ownerName,
  readerName,
  verified,
}: {
  check: BraidConditionCompileResult;
  empty: boolean;
  ownerName: string;
  readerName: string;
  verified: boolean;
}) {
  if (!check.ok) {
    return (
      <HStack
        gap={2}
        align="start"
        color="red.fg"
        fontSize="sm"
        role="alert"
        data-testid="braid-condition-check"
      >
        <AlertTriangle size={14} aria-hidden />
        <Text>{`${check.construct[0]?.toUpperCase() ?? ""}${check.construct.slice(1)} isn't supported. ${check.fix}`}</Text>
      </HStack>
    );
  }
  if (empty) {
    return (
      <HStack gap={2} color="orange.fg" fontSize="sm" data-testid="braid-condition-check">
        <AlertTriangle size={14} aria-hidden />
        <Text>{`No condition: every span from ${ownerName} shows in ${readerName}'s traces.`}</Text>
      </HStack>
    );
  }
  return (
    <HStack gap={2} color="green.fg" fontSize="sm" data-testid="braid-condition-check">
      <CheckCircle2 size={14} aria-hidden />
      <Text>{verified ? "Looks good · signed calls only" : "Looks good"}</Text>
    </HStack>
  );
}

export function BraidConditionField(props: BraidConditionFieldProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  useEffect(() => {
    if (caret === null || !textarea.current) return;
    textarea.current.focus();
    textarea.current.setSelectionRange(caret, caret);
    setCaret(null);
  }, [caret]);
  const insert = (key: string) => {
    const cursor = textarea.current?.selectionStart ?? props.value.length;
    const next = insertAttribute({ where: props.value, cursor, key });
    props.onChange(next.where);
    setCaret(next.caret);
  };

  return (
    <Field.Root invalid={!props.check.ok}>
      <HStack justify="space-between" width="full">
        <Field.Label>
          Condition{" "}
          <Text as="span" color="fg.subtle" fontSize="xs">
            OTTL
          </Text>
        </Field.Label>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              size="xs"
              variant="ghost"
              data-testid="braid-insert-attribute"
              disabled={props.attributeKeys.length === 0}
            >
              <Plus size={12} aria-hidden />
              Insert attribute
              <ChevronDown size={12} aria-hidden />
            </Button>
          </Menu.Trigger>
          <Menu.Content maxHeight="280px" overflowY="auto">
            {props.attributeKeys.map(({ key, spanCount }) => (
              <Menu.Item
                key={key}
                value={key}
                onClick={() => insert(key)}
                data-testid="braid-attribute"
              >
                <HStack justify="space-between" width="full" gap={4}>
                  <Text fontFamily="mono" fontSize="sm">
                    {key}
                  </Text>
                  <Text
                    color="fg.subtle"
                    fontSize="xs"
                  >{`${spanCount.toLocaleString("en-GB")} spans`}</Text>
                </HStack>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
      </HStack>
      <Textarea
        ref={textarea}
        aria-label="Condition"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        fontFamily="mono"
        fontVariantLigatures="none"
        fontSize="sm"
        rows={4}
        spellCheck={false}
        placeholder={'attributes["orchestrator"] == "web"'}
        data-testid="braid-condition"
      />
      <Stack gap={2} width="full">
        {props.check.ok ? null : <RefusedText text={props.value} at={props.check.at} />}
        <CheckLine
          check={props.check}
          empty={props.value.trim().length === 0}
          ownerName={props.ownerName}
          readerName={props.readerName}
          verified={props.verified}
        />
      </Stack>
    </Field.Root>
  );
}
