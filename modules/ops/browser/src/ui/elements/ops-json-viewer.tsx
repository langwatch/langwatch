import { Box, Text } from "@chakra-ui/react";
import { useMemo } from "react";

interface JsonViewerProps {
  data: unknown;
  previousData?: unknown;
  maxHeight?: string;
}

const indexPath = (path: string, i: number) => (path ? `${path}[${i}]` : `[${i}]`);
const keyPath = (path: string, key: string) => (path ? `${path}.${key}` : key);

function addChildChanges({
  changed,
  inPrev,
  inCurr,
  prev,
  curr,
  childPath,
}: {
  changed: Set<string>;
  inPrev: boolean;
  inCurr: boolean;
  prev: unknown;
  curr: unknown;
  childPath: string;
}): void {
  if (!inPrev || !inCurr) {
    changed.add(childPath);
    return;
  }
  for (const p of findChangedPaths(prev, curr, childPath)) changed.add(p);
}

function findChangedArrayPaths(prev: unknown[], curr: unknown[], path: string): Set<string> {
  const changed = new Set<string>();
  for (let i = 0; i < Math.max(prev.length, curr.length); i++) {
    addChildChanges({
      changed,
      inPrev: i < prev.length,
      inCurr: i < curr.length,
      prev: prev[i],
      curr: curr[i],
      childPath: indexPath(path, i),
    });
  }
  return changed;
}

function findChangedObjectPaths(
  prevObj: Record<string, unknown>,
  currObj: Record<string, unknown>,
  path: string,
): Set<string> {
  const changed = new Set<string>();
  for (const key of new Set([...Object.keys(prevObj), ...Object.keys(currObj)])) {
    addChildChanges({
      changed,
      inPrev: key in prevObj,
      inCurr: key in currObj,
      prev: prevObj[key],
      curr: currObj[key],
      childPath: keyPath(path, key),
    });
  }
  return changed;
}

function findChangedPaths(prev: unknown, curr: unknown, path = ""): Set<string> {
  if (prev === curr) return new Set();

  const eitherIsAScalar =
    prev === null || curr === null || typeof prev !== "object" || typeof curr !== "object";
  const prevIsArray = Array.isArray(prev);
  if (eitherIsAScalar || prevIsArray !== Array.isArray(curr)) {
    return new Set(path ? [path] : []);
  }
  if (Array.isArray(prev) && Array.isArray(curr)) return findChangedArrayPaths(prev, curr, path);
  return findChangedObjectPaths(
    prev as Record<string, unknown>,
    curr as Record<string, unknown>,
    path,
  );
}

function isPathOrAncestorChanged(path: string, changedPaths: Set<string>): boolean {
  if (changedPaths.has(path)) return true;
  return [...changedPaths].some(
    (changed) => changed.startsWith(`${path}.`) || changed.startsWith(`${path}[`),
  );
}

interface RenderContext {
  changedPaths: Set<string>;
  indent: number;
}

interface ContainerChild {
  childPath: string;
  label?: string;
  value: unknown;
}

function scalarToken(value: unknown): { color: string; text: string } {
  if (value === null) return { color: "red.400", text: "null" };
  if (typeof value === "boolean") return { color: "purple.400", text: String(value) };
  if (typeof value === "number") return { color: "orange.400", text: String(value) };
  if (typeof value === "string") {
    const text = value.length > 200 ? `"${value.slice(0, 200)}..."` : `"${value}"`;
    return { color: "green.400", text };
  }
  return { color: "fg.muted", text: JSON.stringify(value) ?? "undefined" };
}

function renderContainer({
  open,
  close,
  path,
  ctx,
  children,
}: {
  open: string;
  close: string;
  path: string;
  ctx: RenderContext;
  children: ContainerChild[];
}): React.ReactNode[] {
  if (children.length === 0) {
    return [
      <TokenSpan key={path} color="fg.muted" path={path} changedPaths={ctx.changedPaths}>
        {`${open}${close}`}
      </TokenSpan>,
    ];
  }
  const childIndent = ctx.indent + 1;
  const padding = "  ".repeat(childIndent);
  return [
    <span key={`${path}-open`}>{open}</span>,
    ...children.map(({ childPath, label, value }, i) => (
      <DiffLine key={childPath} highlight={isPathOrAncestorChanged(childPath, ctx.changedPaths)}>
        {padding}
        {label === undefined ? null : (
          <>
            <Text as="span" color="cyan.400">
              {`"${label}"`}
            </Text>
            {": "}
          </>
        )}
        {renderValue(value, childPath, { ...ctx, indent: childIndent })}
        {i < children.length - 1 ? "," : ""}
      </DiffLine>
    )),
    <span key={`${path}-close`}>
      {"  ".repeat(ctx.indent)}
      {close}
    </span>,
  ];
}

function renderValue(value: unknown, path: string, ctx: RenderContext): React.ReactNode[] {
  if (Array.isArray(value)) {
    const children = value.map((item, i) => ({ childPath: indexPath(path, i), value: item }));
    return renderContainer({ open: "[", close: "]", path, ctx, children });
  }
  if (value !== null && typeof value === "object") {
    const children = Object.entries(value).map(([label, item]) => ({
      childPath: keyPath(path, label),
      label,
      value: item,
    }));
    return renderContainer({ open: "{", close: "}", path, ctx, children });
  }
  const { color, text } = scalarToken(value);
  return [
    <TokenSpan key={path} color={color} path={path} changedPaths={ctx.changedPaths}>
      {text}
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

function DiffLine({ children, highlight }: { children: React.ReactNode; highlight: boolean }) {
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
