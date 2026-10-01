/**
 * This function is used to compute the size in pixels of a range of items in a list.
 * If you want the size taken by items from index 0 to 5, you can call this function with
 * start = 0 and end = 5. The size is computed by summing the size of each item in the range.
 * @param data The list of items
 * @param itemSizeInPx The size of an item in pixels. It can be a number or a function that takes an item and returns a number.
 * @param start The start index of the range
 * @param end The end index of the range
 * @returns The size in pixels of the range of items
 **/
export const getSizeInPxFromOneItemToAnother = <T>(
  data: T[],
  itemSizeInPx: number | ((item: T) => number),
  start: number,
  end: number,
): number => {
  if (typeof itemSizeInPx === 'function') {
    return data.slice(start, end).reduce((acc, item) => acc + itemSizeInPx(item), 0);
  }
  return data.slice(start, end).length * itemSizeInPx;
};

/**
 * Computes, in one pass, the offset of every item: offsets[i] is the size in pixels of items 0 to i - 1,
 * so offsets[data.length] is the total size of the list.
 * Use it instead of calling getSizeInPxFromOneItemToAnother for each index, which is quadratic.
 */
export const computeItemOffsets = <T>(
  data: T[],
  itemSizeInPx: number | ((item: T) => number),
): number[] => {
  const offsets: number[] = new Array(data.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < data.length; index++) {
    offsets[index + 1] =
      offsets[index] +
      (typeof itemSizeInPx === 'function' ? itemSizeInPx(data[index]) : itemSizeInPx);
  }
  return offsets;
};
