import {
  ForwardedRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ScrollBehavior, VirtualizedListProps } from './VirtualizedList';

import {
  SpatialNavigationVirtualizedListWithVirtualNodes,
  SpatialNavigationVirtualizedListWithVirtualNodesProps,
  SpatialNavigationVirtualizedListWithVirtualNodesRef,
} from './SpatialNavigationVirtualizedListWithVirtualNodes';
import {
  ScrollToNodeCallback,
  SpatialNavigatorParentScrollContext,
  useSpatialNavigatorParentScroll,
} from '../../context/ParentScrollContext';
import { typedMemo } from '../../helpers/TypedMemo';
import { useSpatialNavigationDeviceType } from '../../context/DeviceContext';
import { View, Platform, ViewStyle, Dimensions } from 'react-native';
import { useSpatialNavigator } from '../../context/SpatialNavigatorContext';
import React from 'react';
import { DefaultFocus, useSpatialNavigatorDefaultFocus } from '../../context/DefaultFocusContext';
import { typedForwardRef } from '../../helpers/TypedForwardRef';
import { SpatialNavigationVirtualizedListRef } from '../../types/SpatialNavigationVirtualizedListRef';
import { useParentId } from '../../context/ParentIdContext';
import { LoopWindow, getLogicalIndex, getLoopWindow } from './helpers/getLoopWindow';
import { getNumberOfItemsVisibleOnScreen } from './helpers/getNumberOfItemsVisibleOnScreen';
import { getAdditionalNumberOfItemsRendered } from './helpers/getAdditionalNumberOfItemsRendered';
import { getLoopWindowSizeInPx } from './helpers/computeLoopItemOffsets';

const ItemWrapperWithScrollContext = typedMemo(
  <T,>({
    setCurrentlyFocusedItemIndex,
    item,
    index,
    renderItem,
    loop,
  }: {
    setCurrentlyFocusedItemIndex: (i: number) => void;
    item: T;
    index: number;
    renderItem: VirtualizedListProps<T>['renderItem'];
    loop: boolean;
  }) => {
    const parentHasDefaultFocus = useSpatialNavigatorDefaultFocus();
    const { scrollToNodeIfNeeded: makeParentsScrollToNodeIfNeeded } =
      useSpatialNavigatorParentScroll();

    const scrollToItem: ScrollToNodeCallback = useCallback(
      (newlyFocusedElementRef, additionalOffset) => {
        setCurrentlyFocusedItemIndex(index);
        // We need to propagate the scroll event for parents if we have nested ScrollViews/VirtualizedLists.
        makeParentsScrollToNodeIfNeeded(newlyFocusedElementRef, additionalOffset);
      },
      [makeParentsScrollToNodeIfNeeded, setCurrentlyFocusedItemIndex, index],
    );

    const renderedItem = (
      <SpatialNavigatorParentScrollContext.Provider value={scrollToItem}>
        {renderItem({ item, index })}
      </SpatialNavigatorParentScrollContext.Provider>
    );

    // A looping list renders items before its first item (index 0): the default focus is not on the first rendered one
    return loop ? (
      <DefaultFocus enable={parentHasDefaultFocus && index === 0}>{renderedItem}</DefaultFocus>
    ) : (
      renderedItem
    );
  },
);
ItemWrapperWithScrollContext.displayName = 'ItemWrapperWithScrollContext';

export type SpatialNavigationVirtualizedListWithScrollProps<T> = Omit<
  SpatialNavigationVirtualizedListWithVirtualNodesProps<T>,
  'currentlyFocusedItemIndex' | 'indexOffset' | 'startOffsetPx' | 'onRenderedItemsCountChange'
>;

/** Items added around the number of rendered items when sizing the loop window, to have some room for fast key repeats. */
const LOOP_WINDOW_SAFETY_MARGIN = 2;

type LoopParams = {
  loop: boolean;
  dataLength: number;
  lookahead: number;
  lookbehind: number;
};

type FocusState = {
  /** Absolute index when the list loops, plain index otherwise */
  focusedIndex: number;
  /** Only meaningful when the list loops */
  window: LoopWindow;
  dataLength: number;
};

type FocusAction =
  | {
      type: 'focus';
      update: number | ((previousIndex: number) => number);
      /** Do not move the window (ex: `ref.focus`: the real focus has not moved yet) */
      keepWindow?: boolean;
      params: LoopParams;
    }
  | { type: 'reset'; params: LoopParams };

const getInitialFocusState = (params: LoopParams): FocusState => ({
  focusedIndex: 0,
  window:
    params.loop && params.dataLength > 0
      ? getLoopWindow({ ...params, focusedIndex: 0 })
      : { start: 0, end: params.dataLength },
  dataLength: params.dataLength,
});

/**
 * The focused index and the loop window are updated together, so that the window always
 * contains the focused item (and the registered virtual nodes) in every render.
 */
const focusReducer = (state: FocusState, action: FocusAction): FocusState => {
  switch (action.type) {
    case 'focus': {
      const focusedIndex =
        typeof action.update === 'function' ? action.update(state.focusedIndex) : action.update;
      if (!action.params.loop) {
        return focusedIndex === state.focusedIndex ? state : { ...state, focusedIndex };
      }
      if (action.params.dataLength === 0) return state;
      const window = action.keepWindow
        ? state.window
        : getLoopWindow({ ...action.params, focusedIndex, previous: state.window });
      return focusedIndex === state.focusedIndex && window === state.window
        ? state
        : { ...state, focusedIndex, window };
    }
    case 'reset': {
      // The data changed: keep the same logical item focused when possible, and rebuild the window around it
      const { dataLength } = action.params;
      if (dataLength === 0) return { focusedIndex: 0, window: { start: 0, end: 0 }, dataLength };
      const previousLogicalIndex =
        state.dataLength > 0 ? getLogicalIndex(state.focusedIndex, state.dataLength) : 0;
      const focusedIndex = Math.min(previousLogicalIndex, Math.max(dataLength - 1, 0));
      return {
        focusedIndex,
        window: getLoopWindow({ ...action.params, focusedIndex }),
        dataLength,
      };
    }
  }
};

const repeatData = <T,>(data: T[], numberOfCycles: number): T[] => {
  const result: T[] = [];
  for (let cycle = 0; cycle < numberOfCycles; cycle++) result.push(...data);
  return result;
};

/**
 * Number of items that must be materialized after (and before) the focused item.
 * The size of the list is not known before the layout, so we use the size of the screen as an upper bound,
 * and the number of items actually rendered by the VirtualizedList as soon as it is known.
 */
const useLoopLookahead = <T,>({
  data,
  itemSize,
  orientation,
  scrollBehavior,
  additionalItemsRendered,
  measuredNumberOfRenderedItems,
  loop,
}: {
  loop: boolean;
  data: T[];
  itemSize: number | ((item: T) => number);
  orientation: 'horizontal' | 'vertical';
  scrollBehavior: ScrollBehavior;
  additionalItemsRendered: number;
  measuredNumberOfRenderedItems: number;
}) => {
  // Nothing to compute for a list that does not loop
  if (!loop) return 0;
  const screen = Dimensions.get('window');
  const listSizeInPx = orientation === 'vertical' ? screen.height : screen.width;
  const numberOfItemsVisibleOnScreen = getNumberOfItemsVisibleOnScreen({
    data,
    listSizeInPx,
    itemSize,
  });
  const estimatedNumberOfRenderedItems = getAdditionalNumberOfItemsRendered(
    scrollBehavior,
    numberOfItemsVisibleOnScreen,
    additionalItemsRendered,
  );
  return (
    Math.max(estimatedNumberOfRenderedItems, measuredNumberOfRenderedItems) +
    LOOP_WINDOW_SAFETY_MARGIN
  );
};

export type PointerScrollProps = {
  descendingArrow?: React.ReactElement;
  descendingArrowContainerStyle?: ViewStyle;
  ascendingArrow?: React.ReactElement;
  ascendingArrowContainerStyle?: ViewStyle;
  scrollInterval?: number;
};

const useRemotePointerVirtualizedListScrollProps = <T,>({
  setCurrentlyFocusedItemIndex,
  scrollInterval,
  data,
  loop,
}: {
  setCurrentlyFocusedItemIndex: React.Dispatch<React.SetStateAction<number>>;
  scrollInterval: number;
  data: T[];
  /** A looping list has no bounds */
  loop: boolean;
}) => {
  const {
    deviceType,
    deviceTypeRef,
    getScrollingIntervalId: getScrollingId,
    setScrollingIntervalId: setScrollingId,
  } = useSpatialNavigationDeviceType();

  const navigator = useSpatialNavigator();

  const idRef = useRef<SpatialNavigationVirtualizedListWithVirtualNodesRef>(null);

  const grabFocus = navigator.grabFocus;

  const onMouseEnterDescending = useCallback(() => {
    const callback = () => {
      setCurrentlyFocusedItemIndex((index) => {
        if (loop || index > 0) {
          if (idRef.current) grabFocus(idRef.current.getNthVirtualNodeID(index - 1));
          return index - 1;
        } else {
          return index;
        }
      });
    };

    const id = setInterval(() => {
      callback();
    }, scrollInterval);
    setScrollingId(id);
  }, [grabFocus, loop, scrollInterval, setCurrentlyFocusedItemIndex, setScrollingId]);

  const onMouseLeave = useCallback(() => {
    const intervalId = getScrollingId();
    if (intervalId) {
      clearInterval(intervalId);
      setScrollingId(null);
    }
  }, [getScrollingId, setScrollingId]);

  const onMouseEnterAscending = useCallback(() => {
    const callback = () => {
      setCurrentlyFocusedItemIndex((index) => {
        if (loop || index < data.length - 1) {
          if (idRef.current) {
            grabFocus(idRef.current.getNthVirtualNodeID(index + 1));
          }
          return index + 1;
        } else {
          return index;
        }
      });
    };
    const id = setInterval(() => {
      callback();
    }, scrollInterval);
    setScrollingId(id);
  }, [data.length, grabFocus, loop, scrollInterval, setCurrentlyFocusedItemIndex, setScrollingId]);

  const descendingArrowProps = useMemo(
    () =>
      Platform.select({
        web: {
          onMouseEnter: onMouseEnterDescending,
          onMouseLeave: onMouseLeave,
        },
      }),
    [onMouseEnterDescending, onMouseLeave],
  );

  const ascendingArrowProps = useMemo(
    () =>
      Platform.select({
        web: {
          onMouseEnter: onMouseEnterAscending,
          onMouseLeave: onMouseLeave,
        },
      }),
    [onMouseEnterAscending, onMouseLeave],
  );

  return {
    descendingArrowProps,
    ascendingArrowProps,
    idRef,
    deviceType,
    deviceTypeRef,
  };
};

/**
 * This component wraps every item of a virtualizedList in a scroll handling context.
 */
export const SpatialNavigationVirtualizedListWithScroll = typedMemo(
  typedForwardRef(
    <T,>(
      props: SpatialNavigationVirtualizedListWithScrollProps<T> & PointerScrollProps,
      ref: ForwardedRef<SpatialNavigationVirtualizedListRef>,
    ) => {
      const {
        data,
        renderItem,
        descendingArrow: descendingArrow,
        ascendingArrow: ascendingArrow,
        descendingArrowContainerStyle,
        ascendingArrowContainerStyle,
        scrollInterval = 100,
      } = props;
      const dataLength = data.length;
      const scrollBehavior = props.scrollBehavior ?? 'stick-to-start';
      const orientation = props.orientation ?? 'horizontal';

      const isLoopSupported = scrollBehavior === 'stick-to-start';
      useEffect(() => {
        if (props.loop && !isLoopSupported) {
          console.error(
            `[SpatialNavigationVirtualizedList] The "loop" prop only supports the "stick-to-start" scroll behavior (got "${scrollBehavior}"). The list will not loop.`,
          );
        }
      }, [props.loop, isLoopSupported, scrollBehavior]);
      // Does not depend on the length of the data: it changes the way virtual nodes are identified, so it must be stable.
      // (toggling `loop` or `scrollBehavior` while the list is mounted is not supported)
      const loop = !!props.loop && isLoopSupported;

      const [measuredNumberOfRenderedItems, setMeasuredNumberOfRenderedItems] = useState(0);
      const lookahead = useLoopLookahead({
        data,
        itemSize: props.itemSize,
        orientation,
        scrollBehavior,
        additionalItemsRendered: props.additionalItemsRendered ?? 2,
        measuredNumberOfRenderedItems,
        loop,
      });
      const loopParams: LoopParams = { loop, dataLength, lookahead, lookbehind: lookahead };
      // Dispatched functions read the params at the time they are called
      const loopParamsRef = useRef(loopParams);
      loopParamsRef.current = loopParams;

      const [focusState, dispatchFocus] = useReducer(
        focusReducer,
        loopParams,
        getInitialFocusState,
      );
      const { focusedIndex: currentlyFocusedItemIndex, window: loopWindow } = focusState;

      const updateFocusedIndex = useCallback(
        (update: number | ((previousIndex: number) => number), keepWindow = false) =>
          dispatchFocus({ type: 'focus', update, keepWindow, params: loopParamsRef.current }),
        [],
      );
      const setCurrentlyFocusedItemIndex: React.Dispatch<React.SetStateAction<number>> =
        updateFocusedIndex;

      // The data changed: rebuild the window around the same logical item
      // (done while rendering, so that the window never mismatches the data)
      if (loop && focusState.dataLength !== dataLength) {
        dispatchFocus({ type: 'reset', params: loopParams });
      }

      // The window must grow if the number of rendered items turns out to be bigger than estimated
      useEffect(() => {
        if (loop) updateFocusedIndex((index) => index);
      }, [loop, lookahead, updateFocusedIndex]);

      const spatialNavigator = useSpatialNavigator();
      const { deviceType, deviceTypeRef, descendingArrowProps, ascendingArrowProps, idRef } =
        useRemotePointerVirtualizedListScrollProps({
          setCurrentlyFocusedItemIndex,
          scrollInterval,
          data,
          loop,
        });

      // The virtual nodes of the previous data have been unregistered. If the focus was in the list, it moved to
      // another item: focus the item that is supposed to be focused again. If it was elsewhere, do not steal it,
      // only make this item the one that will be focused when the focus enters the list.
      const listId = useParentId();
      const previousDataLength = useRef(dataLength);
      useEffect(() => {
        if (previousDataLength.current === dataLength) return;
        previousDataLength.current = dataLength;
        if (!loop || !idRef.current || dataLength === 0) return;
        const focusedNodeId = idRef.current.getNthVirtualNodeID(currentlyFocusedItemIndex);
        if (spatialNavigator.isFocusWithin(listId)) {
          spatialNavigator.grabFocusDeferred(focusedNodeId);
        } else {
          spatialNavigator.setActiveChild(listId, focusedNodeId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the length of the data changes
      }, [dataLength]);

      const setCurrentlyFocusedItemIndexCallback = useCallback(
        (index: number) => {
          deviceTypeRef.current === 'remoteKeys' ? updateFocusedIndex(index) : null;
        },
        [deviceTypeRef, updateFocusedIndex],
      );

      /** Absolute index of the item at the given logical index that is the closest to the focused one, in the window */
      const getClosestAbsoluteIndex = useCallback(
        (index: number) => {
          if (!loop || dataLength === 0) return index;
          const logicalIndex = getLogicalIndex(index, dataLength);
          const sameCycleIndex =
            currentlyFocusedItemIndex -
            getLogicalIndex(currentlyFocusedItemIndex, dataLength) +
            logicalIndex;
          const candidates = [
            sameCycleIndex - dataLength,
            sameCycleIndex,
            sameCycleIndex + dataLength,
          ]
            .filter((candidate) => candidate >= loopWindow.start && candidate < loopWindow.end)
            // closest first, the next one in case of equality
            .sort(
              (a, b) =>
                Math.abs(a - currentlyFocusedItemIndex) - Math.abs(b - currentlyFocusedItemIndex) ||
                b - a,
            );
          return candidates[0] ?? sameCycleIndex;
        },
        [loop, dataLength, currentlyFocusedItemIndex, loopWindow],
      );

      const scrollTo = useCallback(
        (index: number) => {
          if (idRef.current) {
            const newId = idRef.current.getNthVirtualNodeID(getClosestAbsoluteIndex(index));
            spatialNavigator.grabFocusDeferred(newId);
          }
        },
        [idRef, spatialNavigator, getClosestAbsoluteIndex],
      );

      useImperativeHandle(
        ref,
        () => ({
          focus: (index: number) => {
            // The window must not move before the focus actually moved: the node currently focused has to stay registered
            updateFocusedIndex(getClosestAbsoluteIndex(index), true);
            scrollTo(index);
          },
          scrollTo,
          currentlyFocusedItemIndex:
            loop && dataLength > 0
              ? getLogicalIndex(currentlyFocusedItemIndex, dataLength)
              : currentlyFocusedItemIndex,
        }),
        [
          currentlyFocusedItemIndex,
          scrollTo,
          updateFocusedIndex,
          getClosestAbsoluteIndex,
          loop,
          dataLength,
        ],
      );

      // The data of the list is repeated to make it loop. Items are identified by their absolute index internally,
      // but the user only knows about the index in `data`
      const renderLogicalItem: typeof props.renderItem = useCallback(
        ({ item, index }) =>
          renderItem({
            item,
            index: loop && dataLength > 0 ? getLogicalIndex(index, dataLength) : index,
          }),
        [renderItem, loop, dataLength],
      );

      const renderWrappedItem: typeof props.renderItem = useCallback(
        ({ item, index }) => (
          <ItemWrapperWithScrollContext
            setCurrentlyFocusedItemIndex={setCurrentlyFocusedItemIndexCallback}
            renderItem={loop ? renderLogicalItem : renderItem}
            item={item}
            index={index}
            loop={loop}
          />
        ),
        [setCurrentlyFocusedItemIndexCallback, renderItem, renderLogicalItem, loop],
      );

      const numberOfCycles =
        loop && dataLength > 0 ? (loopWindow.end - loopWindow.start) / dataLength : 1;
      const windowData = useMemo(
        () => (loop && dataLength > 0 ? repeatData(data, numberOfCycles) : data),
        [loop, data, dataLength, numberOfCycles],
      );
      const startOffsetPx = useMemo(
        () =>
          loop && dataLength > 0
            ? (loopWindow.start / dataLength) * getLoopWindowSizeInPx(data, props.itemSize)
            : 0,
        [loop, loopWindow.start, dataLength, data, props.itemSize],
      );

      return (
        <>
          <SpatialNavigationVirtualizedListWithVirtualNodes
            {...props}
            data={windowData}
            loop={loop}
            indexOffset={loop ? loopWindow.start : 0}
            startOffsetPx={startOffsetPx}
            onRenderedItemsCountChange={loop ? setMeasuredNumberOfRenderedItems : undefined}
            getNodeIdRef={idRef}
            currentlyFocusedItemIndex={currentlyFocusedItemIndex}
            renderItem={renderWrappedItem}
          />
          {deviceType === 'remotePointer' ? (
            <PointerScrollArrows
              descendingArrowContainerStyle={descendingArrowContainerStyle}
              descendingArrowProps={descendingArrowProps}
              descendingArrow={descendingArrow}
              ascendingArrowContainerStyle={ascendingArrowContainerStyle}
              ascendingArrowProps={ascendingArrowProps}
              ascendingArrow={ascendingArrow}
            />
          ) : undefined}
        </>
      );
    },
  ),
);
SpatialNavigationVirtualizedListWithScroll.displayName =
  'SpatialNavigationVirtualizedListWithScroll';

const PointerScrollArrows = React.memo(
  ({
    ascendingArrow,
    ascendingArrowProps,
    ascendingArrowContainerStyle,
    descendingArrow,
    descendingArrowProps,
    descendingArrowContainerStyle,
  }: PointerScrollProps & {
    descendingArrowProps?: { onMouseEnter: () => void; onMouseLeave: () => void };
    ascendingArrowProps?: { onMouseEnter: () => void; onMouseLeave: () => void };
  }) => {
    return (
      <>
        <View style={descendingArrowContainerStyle} {...descendingArrowProps}>
          {descendingArrow}
        </View>
        <View style={ascendingArrowContainerStyle} {...ascendingArrowProps}>
          {ascendingArrow}
        </View>
      </>
    );
  },
);
PointerScrollArrows.displayName = 'PointerScrollArrows';
