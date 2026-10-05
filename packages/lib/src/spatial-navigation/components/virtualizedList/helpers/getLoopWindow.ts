/**
 * Window of absolute indexes `[start, end)` that is materialized when the list loops.
 * Both bounds are always multiples of the data length (the window is made of whole cycles).
 * Absolute indexes can be negative: the logical index is `((abs % N) + N) % N`.
 */
export type LoopWindow = { start: number; end: number };

export const getLogicalIndex = (absoluteIndex: number, dataLength: number) =>
  ((absoluteIndex % dataLength) + dataLength) % dataLength;

const isSameWindow = (a: LoopWindow, b: LoopWindow) => a.start === b.start && a.end === b.end;

/**
 * Computes which cycles of the data must be materialized around the focused item.
 *
 * - A cycle is added on the side where the focused item gets closer than `lookahead` / `lookbehind` items to the edge.
 * - A cycle is removed only when it is entirely further than the needed range + a hysteresis margin,
 *   so that going back and forth around a boundary never adds and removes the same cycle.
 * - The `previous` window is returned as is when nothing changes (referential equality).
 */
export const getLoopWindow = ({
  dataLength,
  focusedIndex,
  previous,
  lookahead,
  lookbehind,
}: {
  dataLength: number;
  focusedIndex: number;
  previous?: LoopWindow;
  lookahead: number;
  lookbehind: number;
}): LoopWindow => {
  const neededStart = focusedIndex - lookbehind;
  const neededEnd = focusedIndex + lookahead + 1;
  const trimMargin = Math.max(lookahead, lookbehind);

  let start = previous ? previous.start : Math.floor(neededStart / dataLength) * dataLength;
  let end = previous ? previous.end : Math.ceil(neededEnd / dataLength) * dataLength;

  while (start > neededStart) start -= dataLength;
  while (end < neededEnd) end += dataLength;

  while (start + dataLength + trimMargin <= neededStart) start += dataLength;
  while (end - dataLength - trimMargin >= neededEnd) end -= dataLength;

  const next = { start, end };
  return previous && isSameWindow(previous, next) ? previous : next;
};
