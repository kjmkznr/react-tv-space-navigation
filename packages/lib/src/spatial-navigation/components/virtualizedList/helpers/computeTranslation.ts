import { ScrollBehavior } from '../VirtualizedList';
import { getSizeInPxFromOneItemToAnother } from './getSizeInPxFromOneItemToAnother';

const computeStickToStartTranslation = <T>({
  currentlyFocusedItemIndex,
  itemSizeInPx,
  data,
  maxPossibleLeftAlignedIndex,
  itemOffsets,
}: {
  currentlyFocusedItemIndex: number;
  itemSizeInPx: number | ((item: T) => number);
  data: T[];
  maxPossibleLeftAlignedIndex: number;
  itemOffsets?: number[];
}) => {
  const end = Math.min(currentlyFocusedItemIndex, maxPossibleLeftAlignedIndex);
  const scrollOffset = itemOffsets
    ? itemOffsets[Math.min(end, data.length)]
    : getSizeInPxFromOneItemToAnother(data, itemSizeInPx, 0, end);
  return -scrollOffset;
};

const computeStickToEndTranslation = <T>({
  currentlyFocusedItemIndex,
  itemSizeInPx,
  data,
  listSizeInPx,
  maxPossibleRightAlignedIndex,
  itemOffsets,
}: {
  currentlyFocusedItemIndex: number;
  itemSizeInPx: number | ((item: T) => number);
  data: T[];
  listSizeInPx: number;
  maxPossibleRightAlignedIndex: number;
  itemOffsets?: number[];
}) => {
  if (currentlyFocusedItemIndex <= maxPossibleRightAlignedIndex) return -0;

  const currentlyFocusedItemSize =
    typeof itemSizeInPx === 'function'
      ? itemSizeInPx(data[currentlyFocusedItemIndex])
      : itemSizeInPx;

  const sizeOfListFromStartToCurrentlyFocusedItem = itemOffsets
    ? itemOffsets[Math.min(currentlyFocusedItemIndex, data.length)]
    : getSizeInPxFromOneItemToAnother(data, itemSizeInPx, 0, currentlyFocusedItemIndex);

  const scrollOffset =
    sizeOfListFromStartToCurrentlyFocusedItem + currentlyFocusedItemSize - listSizeInPx;
  return -scrollOffset;
};

const computeJumpOnScrollTranslation = <T>({
  currentlyFocusedItemIndex,
  itemSizeInPx,
  nbMaxOfItems,
  numberOfItemsVisibleOnScreen,
}: {
  currentlyFocusedItemIndex: number;
  itemSizeInPx: number | ((item: T) => number);
  nbMaxOfItems: number;
  numberOfItemsVisibleOnScreen: number;
}) => {
  if (typeof itemSizeInPx === 'function')
    throw new Error('jump-on-scroll scroll behavior is not supported with dynamic item size');

  const maxPossibleLeftAlignedIndex = Math.max(nbMaxOfItems - numberOfItemsVisibleOnScreen, 0);
  const indexOfItemToFocus =
    currentlyFocusedItemIndex - (currentlyFocusedItemIndex % numberOfItemsVisibleOnScreen);
  const leftAlignedIndex = Math.min(indexOfItemToFocus, maxPossibleLeftAlignedIndex);
  const scrollOffset = leftAlignedIndex * itemSizeInPx;
  return -scrollOffset;
};

export const computeTranslation = <T>({
  currentlyFocusedItemIndex,
  itemSizeInPx,
  nbMaxOfItems,
  numberOfItemsVisibleOnScreen,
  scrollBehavior,
  data,
  listSizeInPx,
  maxPossibleLeftAlignedIndex,
  maxPossibleRightAlignedIndex,
  itemOffsets,
}: {
  currentlyFocusedItemIndex: number;
  itemSizeInPx: number | ((item: T) => number);
  nbMaxOfItems: number;
  numberOfItemsVisibleOnScreen: number;
  scrollBehavior: ScrollBehavior;
  data: T[];
  listSizeInPx: number;
  maxPossibleLeftAlignedIndex: number;
  maxPossibleRightAlignedIndex: number;
  /** Optional precomputed result of computeItemOffsets(data, itemSizeInPx): avoids a quadratic computation. */
  itemOffsets?: number[];
}) => {
  switch (scrollBehavior) {
    case 'stick-to-start':
      return computeStickToStartTranslation({
        currentlyFocusedItemIndex,
        itemSizeInPx,
        data,
        maxPossibleLeftAlignedIndex,
        itemOffsets,
      });
    case 'stick-to-end':
      return computeStickToEndTranslation({
        currentlyFocusedItemIndex,
        itemSizeInPx,
        data,
        listSizeInPx,
        maxPossibleRightAlignedIndex,
        itemOffsets,
      });
    case 'jump-on-scroll':
      return computeJumpOnScrollTranslation({
        currentlyFocusedItemIndex,
        itemSizeInPx,
        nbMaxOfItems,
        numberOfItemsVisibleOnScreen,
      });
    default:
      throw new Error(`Invalid scroll behavior: ${scrollBehavior}`);
  }
};
