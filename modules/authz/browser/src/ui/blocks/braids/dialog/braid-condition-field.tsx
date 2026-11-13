// The condition, coloured and checked as it is typed: a refusal is underlined in place, its fix in
// one line below, and an attribute the owner's spans carry goes in at the cursor, caret in quotes.

import { type BraidConditionCompileResult } from "@langwatch/authz-contract/braid-condition-compiler";
import { ExpressionTextarea } from "@langwatch/design-system/expression-textarea";
import { Menu } from "@langwatch/design-system/menu";
import { Alert, Button, Field, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { ChevronDown, Plus } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";

import { insertAttribute } from "../../../../model/braids/braid-draft.ts";

export type BraidConditionFieldProps = {
  value: string;
  onChange: (value: string) => void;
  check: BraidConditionCompileResult;
  ownerName: string;
  readerName: string;
  verified: boolean;
  attributeKeys: readonly { key: string; spanCount: number }[];
  /** The textarea, so Edit can open with focus on the condition. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
};

/** Where a refusal's underline ends: the next space after its offset, or the text's end. */
function refusedEnd({ text, at }: { text: string; at: number }): number {
  const space = text.slice(at).search(/\s/);
  return Math.max(at + 1, space === -1 ? text.length : at + space);
}

function CheckLine({
  check,
  empty,
  touched,
  held,
  ownerName,
  readerName,
}: {
  check: BraidConditionCompileResult;
  empty: boolean;
  touched: boolean;
  held: boolean;
  ownerName: string;
  readerName: string;
}) {
  if (held) {
    return (
      <Field.HelperText data-testid="braid-condition-check">
        Type the value between the quotes.
      </Field.HelperText>
    );
  }
  if (!check.ok) {
    return (
      <Field.ErrorText role="alert" data-testid="braid-condition-check">
        {`${check.construct[0]?.toUpperCase() ?? ""}${check.construct.slice(1)} isn't supported. ${check.fix}`}
      </Field.ErrorText>
    );
  }
  if (empty && !touched) {
    return (
      <Field.HelperText data-testid="braid-condition-check">
        {`Which ${ownerName} spans to show. Left empty, all of them show.`}
      </Field.HelperText>
    );
  }
  if (empty) {
    return (
      <Alert.Root status="warning" size="sm" data-testid="braid-condition-empty">
        <Alert.Indicator />
        <Alert.Title fontWeight="normal">
          {`No condition: every span from ${ownerName} shows in ${readerName}'s traces.`}
        </Alert.Title>
      </Alert.Root>
    );
  }
  return null;
}

export function BraidConditionField(props: BraidConditionFieldProps) {
  const own = useRef<HTMLTextAreaElement>(null);
  const textarea = props.textareaRef ?? own;
  const [caret, setCaret] = useState<number | null>(null);
  // The no-condition warning waits until the field has been used, so it never greets a new braid.
  const [touched, setTouched] = useState(false);
  // An inserted comparison's empty quotes are not refused until the text changes: the admin has
  // not typed the value yet. Save stays disabled meanwhile, since the condition does not compile.
  const [inserted, setInserted] = useState<{ where: string; quoteAt: number } | null>(null);
  const held =
    !props.check.ok &&
    inserted !== null &&
    inserted.where === props.value &&
    inserted.quoteAt === props.check.at;
  const refusal =
    !props.check.ok && !held
      ? { at: props.check.at, end: refusedEnd({ text: props.value, at: props.check.at }) }
      : undefined;
  useEffect(() => {
    if (caret === null || !textarea.current) return;
    textarea.current.focus();
    textarea.current.setSelectionRange(caret, caret);
    setCaret(null);
  }, [caret, textarea]);
  const insert = (key: string) => {
    const cursor = textarea.current?.selectionStart ?? props.value.length;
    const next = insertAttribute({ where: props.value, cursor, key });
    props.onChange(next.where);
    setCaret(next.caret);
    setInserted({ where: next.where, quoteAt: next.caret - 1 });
  };

  return (
    <Field.Root invalid={refusal !== undefined}>
      <HStack justify="space-between" width="full">
        <Field.Label>
          Condition{" "}
          <Text as="span" color="fg.muted" textStyle="xs" fontWeight="normal">
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
          <Menu.Content maxHeight="72" overflowY="auto">
            {props.attributeKeys.map(({ key, spanCount }) => (
              <Menu.Item
                key={key}
                value={key}
                onClick={() => insert(key)}
                data-testid="braid-attribute"
              >
                <HStack justify="space-between" width="full" gap={4}>
                  <Text fontFamily="mono" textStyle="sm">
                    {key}
                  </Text>
                  <Text
                    color="fg.muted"
                    textStyle="xs"
                  >{`${spanCount.toLocaleString("en-GB")} spans`}</Text>
                </HStack>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
      </HStack>
      <ExpressionTextarea
        ref={textarea}
        aria-label="Condition"
        value={props.value}
        onChange={(event) => {
          setTouched(true);
          props.onChange(event.target.value);
        }}
        onBlur={() => setTouched(true)}
        mark={refusal}
        rows={4}
        spellCheck={false}
        placeholder={'attributes["orchestrator"] == "web"'}
        data-testid="braid-condition"
      />
      <Stack gap={1.5} width="full">
        <CheckLine
          check={props.check}
          empty={props.value.trim().length === 0}
          touched={touched}
          held={held}
          ownerName={props.ownerName}
          readerName={props.readerName}
        />
      </Stack>
    </Field.Root>
  );
}
