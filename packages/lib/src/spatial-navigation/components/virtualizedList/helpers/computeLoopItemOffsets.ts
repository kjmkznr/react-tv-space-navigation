/**
 * Offsets (in px, in the absolute coordinates system of a looping list) of every item of the window.
 * `startOffsetPx` is the offset of the first item of the window.
 * Computed in one pass, so it is O(window length) even with a dynamic item size.
 */
export const computeLoopItemOffsets = <T>({
  data,
  itemSize,
  startOffsetPx,
}: {
  data: T[];
  itemSize: number | ((item: T) => number);
  startOffsetPx: number;
}): number[] => {
  const offsets = new Array<number>(data.length);
  let offset = startOffsetPx;
  for (let index = 0; index < data.length; index++) {
    offsets[index] = offset;
    offset += typeof itemSize === 'function' ? itemSize(data[index]) : itemSize;
  }
  return offsets;
};

/** Size in px of the items of the window. */
export const getLoopWindowSizeInPx = <T>(data: T[], itemSize: number | ((item: T) => number)) =>
  typeof itemSize === 'function'
    ? data.reduce((acc, item) => acc + itemSize(item), 0)
    : data.length * itemSize;
