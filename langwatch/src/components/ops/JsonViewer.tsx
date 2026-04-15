import { Box, Text } from "@chakra-ui/react";
import { useMemo } from "react";

interface JsonViewerProps {
  data: unknown;
  previousData?: unknown;
  maxHeight?: string;
}

function findChangedPaths(
  prev: unknown,
  curr: unknown,
  path = "",
): Set<string> {
  const changed = new Set<string>();

  if (prev === curr) return changed;

  if (
    prev === null ||
    curr === null ||
    typeof prev !== "object" ||
    typeof curr !== "object"
  ) {
    if (prev !== curr && path) {
      changed.add(path);
    }
    return changed;
  }

  if (Array.isArray(prev) && Array.isArray(curr)) {
    const maxLen = Math.max(prev.length, curr.length);
    for (let i = 0; i < maxLen; i++) {
      const childPath = path ? `${path}[${i}]` : `[${i}]`;
      if (i >= prev.length) {
        changed.add(childPath);
      } else if (i >= curr.length) {
        changed.add(childPath);
      } else {
        for (const p of findChangedPaths(prev[i], curr[i], childPath)) {
          changed.add(p);
        }
      }
    }
    return changed;
  }

  if (Array.isArray(prev) !== Array.isArray(curr)) {
    if (path) changed.add(path);
    return changed;
  }

  const prevObj = prev as Record<string, unknown>;
  const currObj = curr as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(prevObj), ...Object.keys(currObj)]);

  for (const key of allKeys) {
    const childPath = path ? `${path}.${key}` : key;
    if (!(key in prevObj)) {
      changed.add(childPath);
    } else if (!(key in currObj)) {
      changed.add(childPath);
    } else {
      for (const p of findChangedPaths(prevObj[key], currObj[key], childPath)) {
        changed.add(p);
      }
    }
  }

  return changed;
}

function isPathOrAncestorChanged(
  path: string,
  changedPaths: Set<string>,
): boolean {
  if (changedPaths.has(path)) return true;
  for (const changed of changedPaths) {
    if (changed.startsWith(path + ".") || changed.startsWith(path + "[")) {
      return true;
    }
  }
  return false;
}

interface RenderContext {
  changedPaths: Set<string>;
  indent: number;
}

function renderValue(
  value: unknown,
  path: string,
  ctx: RenderContext,
): React.ReactNode[] {
  if (value === null) {
    return [
      <TokenSpan
        key={path}
        color="red.400"
        path={path}
        changedPaths={ctx.changedPaths}
      >
        null
      </TokenSpan>,
    ];
  }

  if (typeof value === "boolean") {
    return [
      <TokenSpan
        key={path}
        color="purple.400"
        path={path}
        changedPaths={ctx.changedPaths}
      >
        {String(value)}
      </TokenSpan>,
    ];
  }

  if (typeof value === "number") {
    return [
      <TokenSpan
        key={path}
        color="orange.400"
        path={path}
        changedPaths={ctx.changedPaths}
      >
        {String(value)}
      </TokenSpan>,
    ];
  }

  if (typeof value === "string") {
    const display =
      value.length > 200 ? `"${value.slice(0, 200)}..."` : `"${value}"`;
    return [
      <TokenSpan
        key={path}
        color="green.400"
        path={path}
        changedPaths={ctx.changedPaths}
      >
        {display}
      </TokenSpan>,
    ];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [
        <TokenSpan
          key={path}
          color="fg.muted"
          path={path}
          changedPaths={ctx.changedPaths}
        >
          {"[]"}
        </TokenSpan>,
      ];
    }

    const lines: React.ReactNode[] = [];
    const childIndent = ctx.indent + 1;
    const padding = "  ".repeat(childIndent);
    const closePadding = "  ".repeat(ctx.indent);

    lines.push(
      <span key={`${path}-open`}>{"["}</span>,
    );

    for (let i = 0; i < value.length; i++) {
      const childPath = path ? `${path}[${i}]` : `[${i}]`;
      const isChanged = isPathOrAncestorChanged(childPath, ctx.changedPaths);
      const childElements = renderValue(value[i], childPath, {
        ...ctx,
        indent: childIndent,
      });
      const comma = i < value.length - 1 ? "," : "";

      lines.push(
        <DiffLine key={childPath} highlight={isChanged}>
          {padding}
          {childElements}
          {comma}
        </DiffLine>,
      );
    }

    lines.push(
      <span key={`${path}-close`}>
        {closePadding}
        {"]"}
      </span>,
    );

    return lines;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return [
        <TokenSpan
          key={path}
          color="fg.muted"
          path={path}
          changedPaths={ctx.changedPaths}
        >
          {"{}"}
        </TokenSpan>,
      ];
    }

    const lines: React.ReactNode[] = [];
    const childIndent = ctx.indent + 1;
    const padding = "  ".repeat(childIndent);
    const closePadding = "  ".repeat(ctx.indent);

    lines.push(
      <span key={`${path}-open`}>{"{"}</span>,
    );

    for (let i = 0; i < entries.length; i++) {
      const [key, val] = entries[i]!;
      const childPath = path ? `${path}.${key}` : key;
      const isChanged = isPathOrAncestorChanged(childPath, ctx.changedPaths);
      const childElements = renderValue(val, childPath, {
        ...ctx,
        indent: childIndent,
      });
      const comma = i < entries.length - 1 ? "," : "";

      lines.push(
        <DiffLine key={childPath} highlight={isChanged}>
          {padding}
          <Text as="span" color="cyan.400">
            {`"${key}"`}
          </Text>
          {": "}
          {childElements}
          {comma}
        </DiffLine>,
      );
    }

    lines.push(
      <span key={`${path}-close`}>
        {closePadding}
        {"}"}
      </span>,
    );

    return lines;
  }

  return [
    <TokenSpan
      key={path}
      color="fg.muted"
      path={path}
      changedPaths={ctx.changedPaths}
    >
      {String(value)}
    </TokenSpan>,
  ];
}

function TokenSpan({
  children,
  color,
  path: _path,
  changedPaths: _changedPaths,
}: {
  children: React.ReactNode;
  color: string;
  path: string;
  changedPaths: Set<string>;
}) {
  return (
    <Text as="span" color={color}>
      {children}
    </Text>
  );
}

function DiffLine({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight: boolean;
}) {
  return (
    <Box
      as="div"
      bg={highlight ? "orange.500/10" : "transparent"}
      borderLeft={highlight ? "2px solid" : "2px solid transparent"}
      borderLeftColor={highlight ? "orange.400" : "transparent"}
      paddingLeft={highlight ? "2px" : "2px"}
      whiteSpace="pre"
    >
      {children}
    </Box>
  );
}

export function JsonViewer({ data, previousData, maxHeight }: JsonViewerProps) {
  const changedPaths = useMemo(() => {
    if (previousData === undefined) return new Set<string>();
    return findChangedPaths(previousData, data);
  }, [data, previousData]);

  const rendered = useMemo(() => {
    return renderValue(data, "", { changedPaths, indent: 0 });
  }, [data, changedPaths]);

  return (
    <Box
      fontFamily="mono"
      fontSize="10px"
      lineHeight="short"
      overflow="auto"
      maxHeight={maxHeight ?? "100%"}
      whiteSpace="pre-wrap"
      wordBreak="break-all"
    >
      {rendered.map((node, i) => (
        <Box key={i}>{node}</Box>
      ))}
    </Box>
  );
}
