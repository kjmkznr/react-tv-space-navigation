import { useCallback, useEffect, useMemo } from 'react';
import { Animated, StyleSheet, View, ViewStyle, Platform } from 'react-native';
import { getRange } from './helpers/getRange';
import {
  useVirtualizedListAnimation,
  useWebVirtualizedListAnimation,
} from './hooks/useVirtualizedListAnimation';
import { NodeOrientation } from '../../types/orientation';
import { typedMemo } from '../../helpers/TypedMemo';
import { getSizeInPxFromOneItemToAnother } from './helpers/getSizeInPxFromOneItemToAnother';
import { computeAllScrollOffsets } from './helpers/createScrollOffsetArray';
import { getNumberOfItemsVisibleOnScreen } from './helpers/getNumberOfItemsVisibleOnScreen';
import { getAdditionalNumberOfItemsRendered } from './helpers/getAdditionalNumberOfItemsRendered';
import { computeLoopItemOffsets, getLoopWindowSizeInPx } from './helpers/computeLoopItemOffsets';

export type ScrollBehavior = 'stick-to-start' | 'stick-to-end' | 'jump-on-scroll';
export interface VirtualizedListProps<T> {
  data: T[];
  renderItem: (args: { item: T; index: number }) => JSX.Element;
  /** If vertical the height of an item, otherwise the width */
  itemSize: number | ((item: T) => number);
  currentlyFocusedItemIndex: number;
  /**
   * How many items are RENDERED ADDITIONALLY to the minimum amount possible. It impacts virtualization size.
   * Defaults to 2.
   *
   * Should be a POSITIVE number.
   *
   * Minimal amount possible is 2N + 1 for jump-on-scroll, and N + 2 for the other behaviours, N being the number
   * of visible elements on the screen.
   *
   * By default, you will then have N + 2 + 2 elements rendered for stick-to-* behaviours.
   */
  additionalItemsRendered?: number;
  onEndReached?: () => void;
  /** Number of items left to display before triggering onEndReached */
  onEndReachedThresholdItemsNumber?: number;
  style?: ViewStyle;
  orientation?: NodeOrientation;
  /**
   * @deprecated
   * Use a custom key instead of the recycling.
   * */
  keyExtractor?: (index: number) => string;
  /** Total number of expected items for infinite scroll (helps aligning items) used for pagination */
  nbMaxOfItems?: number;
  /** Duration of a scrolling animation inside the VirtualizedList */
  scrollDuration?: number;
  /** The size of the list in its scrollable axis */
  listSizeInPx: number;
  scrollBehavior?: ScrollBehavior;
  testID?: string;
  /**
   * Internal. Set by the SpatialNavigationVirtualizedList when `loop` is enabled.
   * `data` is then a window made of whole cycles of the real data, and the indexes
   * (`currentlyFocusedItemIndex`, `index` given to `renderItem`) are absolute indexes: `data[0]` is at `indexOffset`.
   */
  loop?: boolean;
  /** Internal (loop). Absolute index of `data[0]`. */
  indexOffset?: number;
  /** Internal (loop). Offset in px of `data[0]` in the absolute coordinates system. */
  startOffsetPx?: number;
  /** Internal (loop). Called with the number of items actually rendered, to size the loop window. */
  onRenderedItemsCountChange?: (numberOfRenderedItems: number) => void;
}

const useOnEndReached = ({
  numberOfItems,
  range,
  currentlyFocusedItemIndex,
  onEndReachedThresholdItemsNumber,
  onEndReached,
}: {
  numberOfItems: number;
  range: { start: number; end: number };
  currentlyFocusedItemIndex: number;
  onEndReachedThresholdItemsNumber: number;
  onEndReached: (() => void) | undefined;
}) => {
  useEffect(() => {
    if (numberOfItems === 0 || range.end === 0) {
      return;
    }

    if (
      currentlyFocusedItemIndex >= Math.max(numberOfItems - 1 - onEndReachedThresholdItemsNumber, 0)
    ) {
      onEndReached?.();
    }
  }, [
    onEndReached,
    range.end,
    currentlyFocusedItemIndex,
    onEndReachedThresholdItemsNumber,
    numberOfItems,
  ]);
};

const EMPTY_DATA: never[] = [];

const ItemContainerWithAnimatedStyle = typedMemo(
  <T,>({
    item,
    index,
    renderItem,
    itemSize,
    vertical,
    data,
    positionPx,
  }: {
    item: T;
    index: number;
    renderItem: VirtualizedListProps<T>['renderItem'];
    itemSize: number | ((item: T) => number);
    vertical: boolean;
    data: T[];
    /** When given (loop), the position of the item in px. `index` is then an absolute index and is not used to compute it. */
    positionPx?: number;
  }) => {
    const computeOffset = useCallback(
      (item: T, index: number) => {
        if (positionPx !== undefined) return positionPx;
        return typeof itemSize === 'number'
          ? index * itemSize
          : data.slice(0, index).reduce((acc, item) => acc + itemSize(item), 0);
      },
      [data, itemSize, positionPx],
    );

    const style = useMemo(
      () =>
        StyleSheet.flatten([
          styles.item,
          vertical
            ? { transform: [{ translateY: computeOffset(item, index) }] }
            : { transform: [{ translateX: computeOffset(item, index) }] },
        ]),
      [computeOffset, item, index, vertical],
    );
    return <View style={style}>{renderItem({ item, index })}</View>;
  },
);
ItemContainerWithAnimatedStyle.displayName = 'ItemContainerWithAnimatedStyle';

/**
 * DO NOT use this component directly !
 * You should use the component SpatialNavigationVirtualizedList.tsx to render navigable lists of components.
 *
 * Why this has been made:
 *   - it gives us full control on the way we scroll (using CSS animations)
 *   - it is way more performant than a FlatList
 */
export const VirtualizedList = typedMemo(
  <T,>({
    data,
    renderItem,
    itemSize,
    currentlyFocusedItemIndex,
    additionalItemsRendered = 2,
    onEndReached,
    onEndReachedThresholdItemsNumber = 3,
    style,
    orientation = 'horizontal',
    nbMaxOfItems,
    keyExtractor,
    scrollDuration = 200,
    listSizeInPx,
    scrollBehavior = 'stick-to-start',
    testID,
    loop = false,
    indexOffset = 0,
    startOffsetPx = 0,
    onRenderedItemsCountChange,
  }: VirtualizedListProps<T>) => {
    // In loop mode, `currentlyFocusedItemIndex` is an absolute index: `focusedIndex` is its position in `data`
    const focusedIndex = currentlyFocusedItemIndex - indexOffset;

    const numberOfItemsVisibleOnScreen = getNumberOfItemsVisibleOnScreen({
      data,
      listSizeInPx,
      itemSize,
    });

    const numberOfItemsToRender = getAdditionalNumberOfItemsRendered(
      scrollBehavior,
      numberOfItemsVisibleOnScreen,
      additionalItemsRendered,
    );

    const range = getRange({
      data,
      currentlyFocusedItemIndex: focusedIndex,
      numberOfRenderedItems: numberOfItemsToRender,
      numberOfItemsVisibleOnScreen,
      scrollBehavior,
    });

    const vertical = orientation === 'vertical';

    // Only used in loop mode: items are placed in an absolute coordinates system, the same way whatever the window is
    const loopItemOffsets = useMemo(
      () => (loop ? computeLoopItemOffsets({ data, itemSize, startOffsetPx }) : undefined),
      [loop, data, itemSize, startOffsetPx],
    );

    const totalVirtualizedListSize = useMemo(
      () =>
        loop
          ? Math.max(startOffsetPx, 0) + getLoopWindowSizeInPx(data, itemSize)
          : getSizeInPxFromOneItemToAnother(data, itemSize, 0, data.length),
      [loop, startOffsetPx, data, itemSize],
    );

    const dataSliceToRender = data.slice(range.start, range.end + 1);

    const allScrollOffsets = useMemo(
      () =>
        loopItemOffsets
          ? loopItemOffsets.map((offset) => -offset)
          : computeAllScrollOffsets({
              itemSize: itemSize,
              nbMaxOfItems: nbMaxOfItems ?? data.length,
              numberOfItemsVisibleOnScreen: numberOfItemsVisibleOnScreen,
              scrollBehavior: scrollBehavior,
              data: data,
              listSizeInPx: listSizeInPx,
            }),
      [
        data,
        itemSize,
        listSizeInPx,
        nbMaxOfItems,
        numberOfItemsVisibleOnScreen,
        scrollBehavior,
        loopItemOffsets,
      ],
    );

    useOnEndReached({
      numberOfItems: data.length,
      range,
      currentlyFocusedItemIndex: focusedIndex,
      onEndReachedThresholdItemsNumber,
      // A looping list has no end
      onEndReached: loop ? undefined : onEndReached,
    });

    useEffect(() => {
      onRenderedItemsCountChange?.(numberOfItemsToRender);
    }, [onRenderedItemsCountChange, numberOfItemsToRender]);

    const animatedStyle =
      Platform.OS === 'web'
        ? useWebVirtualizedListAnimation({
            currentlyFocusedItemIndex: focusedIndex,
            vertical,
            scrollDuration,
            scrollOffsetsArray: allScrollOffsets,
          })
        : useVirtualizedListAnimation({
            currentlyFocusedItemIndex: focusedIndex,
            vertical,
            scrollDuration,
            scrollOffsetsArray: allScrollOffsets,
          });

    /*
     * This is a performance trick.
     * This custom key with a modulo is actually a "recycled" list implementation.
     *
     * Normally, if I scroll right, the first element needs to be unmounted and a new one needs to be mounted on the right side.
     * But with recycling, the first element won't be unmounted : it is moved to the end and its props are updated.
     * See https://medium.com/@moshe_31114/building-our-recycle-list-solution-in-react-17a21a9605a0  */
    const recycledKeyExtractor = useCallback(
      // `index` can be negative when the list loops
      (index: number) =>
        `recycled_item_${
          ((index % numberOfItemsToRender) + numberOfItemsToRender) % numberOfItemsToRender
        }`,
      [numberOfItemsToRender],
    );

    const directionStyle = useMemo(
      () => ({ flexDirection: vertical ? 'column' : 'row' } as const),
      [vertical],
    );

    /**
     * If the view has the size of the screen, then it is dropped in the component hierarchy when scrolled for more than the screen size (scroll right).
     * To ensure that the view stays visible, we adat its size to the size of the virtualized list.
     * ```
     *                        Screen
     *                  ┌─────────────────────┐
     *  View(container) │                     │
     *        ┌─────────┼───────────────────┐ │
     *        │┌─┬─┬─┬─┬┼┬─┬─┬─┬─┬─┬─┬─┬─┬──┤ │
     *        ││┼│ │┼│ │┼│ │┼│ │┼│ │┼│ │┼│  │ │
     *        │└─┴─┴─┴─┴┼┴─┴─┴─┴─┴─┴─┴─┴─┴──┤ │
     *        └─────────┼───────────────────┘ │
     *                  │                     │
     *                  └─────────────────────┘
     *          ◄───────┼───────────────────►
     *   RowWidth = Screen Width + size of the item on left
     * ```
     */
    const dimensionStyle = useMemo(
      () =>
        vertical
          ? ({
              height: totalVirtualizedListSize,
            } as const)
          : ({ width: totalVirtualizedListSize } as const),
      [totalVirtualizedListSize, vertical],
    );

    return (
      <Animated.View
        style={[styles.container, animatedStyle, style, directionStyle, dimensionStyle]}
        testID={testID}
      >
        <View>
          {dataSliceToRender.map((item, virtualIndex) => {
            const localIndex = range.start + virtualIndex;
            const index = indexOffset + localIndex;
            return (
              <ItemContainerWithAnimatedStyle<T>
                key={keyExtractor ? keyExtractor(index) : recycledKeyExtractor(index)}
                renderItem={renderItem}
                item={item}
                index={index}
                itemSize={itemSize}
                vertical={vertical}
                data={loop ? EMPTY_DATA : data}
                positionPx={loopItemOffsets?.[localIndex]}
              />
            );
          })}
        </View>
      </Animated.View>
    );
  },
);
VirtualizedList.displayName = 'VirtualizedList';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  item: {
    left: 0,
    position: 'absolute',
  },
});
