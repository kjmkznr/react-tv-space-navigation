import uniqueId from 'lodash.uniqueid';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { VirtualizedListProps } from './VirtualizedList';
import { useSpatialNavigator } from '../../context/SpatialNavigatorContext';
import { ParentIdContext, useParentId } from '../../context/ParentIdContext';
import { updateVirtualNodeRegistration } from './helpers/updateVirtualNodeRegistration';
import { updateVirtualNodeRegistrationByRange } from './helpers/updateVirtualNodeRegistrationByRange';
import { typedMemo } from '../../helpers/TypedMemo';
import { useCachedValues } from './hooks/useCachedValues';
import { NodeOrientation } from '../../types/orientation';
import { invertOrientation } from '../virtualizedGrid/helpers/convertToGrid';
import { VirtualizedListWithSize } from './VirtualizedListWithSize';

const useCreateVirtualParentsIds = (parentId: string) =>
  useCachedValues(() => uniqueId(`${parentId}_virtual_`));

/**
 * Hook which will :
 * - register the initial virtualNodes
 * - unregister the final virtualNodes
 * Do it each time the parentId is changing
 */
const useRegisterInitialAndUnregisterFinalVirtualNodes = <T,>({
  allItems,
  indexOffset,
  parentId,
  loop,
  registerNthVirtualNode,
  unregisterNthVirtualNode,
  setInitialActiveNode,
}: {
  allItems: Array<T>;
  indexOffset: number;
  parentId: string;
  loop: boolean;
  registerNthVirtualNode: (index: number, childIndex?: number) => void;
  unregisterNthVirtualNode: (index: number) => void;
  setInitialActiveNode: (index: number) => void;
}) => {
  /** We don't unregister the nodes on each render because we want to update them instead (add new ones, move existing ones...).
   * We register each item in allItems at 1st render, and unregister all the registered nodes on unmount.
   * If data was added to allItems in the meantime (ex: onEndReached), the cleanup function needs to have "access" to this additional data in order to unregister the additional nodes.
   * This means the cleanup function needs to have access to up-to-date data, so we use a reference to the list of data. */
  const currentAllItems = useRef<Array<T>>(allItems);
  currentAllItems.current = allItems;
  // The registered indexes are the absolute indexes `indexOffset + n` (indexOffset is always 0 if the list doesn't loop)
  const currentIndexOffset = useRef<number>(indexOffset);
  currentIndexOffset.current = indexOffset;

  useEffect(() => {
    const start = currentIndexOffset.current;
    const end = start + currentAllItems.current.length;
    // The first nodes registered are the first ones to be focusable. The window of a looping list has items before
    // the first item of the data (absolute index 0): they are registered last, inserted before the others.
    for (let index = Math.max(start, 0); index < end; index++) registerNthVirtualNode(index);
    for (let index = start; index < Math.min(0, end); index++) {
      registerNthVirtualNode(index, index - start);
    }
    // The first item of the data is the one to focus by default
    if (loop) setInitialActiveNode(0);

    return () =>
      currentAllItems.current.forEach((_, n) =>
        unregisterNthVirtualNode(currentIndexOffset.current + n),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unfortunately, we can't have clean effects with lrud for now
  }, [parentId]);
};

const useUpdateRegistration = <T,>({
  allItems,
  indexOffset,
  loop,
  registerNthVirtualNode,
  unregisterNthVirtualNode,
}: {
  allItems: Array<T>;
  indexOffset: number;
  loop: boolean;
  registerNthVirtualNode: (index: number, childIndex?: number) => void;
  unregisterNthVirtualNode: (index: number) => void;
}) => {
  const previousAllItems = useRef<Array<T>>(allItems);
  const previousIndexOffset = useRef<number>(indexOffset);

  // useBeforeMountEffect done every time allItems is changing to change the way the allItems is register in the spatialNavigator
  useEffect(() => {
    const previousAllItemsList = previousAllItems.current;
    const isFirstRender = previousAllItemsList === undefined;
    if (!isFirstRender) {
      if (loop) {
        // The window moves: nodes can be added or removed at the beginning as well as at the end
        updateVirtualNodeRegistrationByRange({
          currentRange: { start: indexOffset, end: indexOffset + allItems.length },
          previousRange: {
            start: previousIndexOffset.current,
            end: previousIndexOffset.current + previousAllItemsList.length,
          },
          addVirtualNode: registerNthVirtualNode,
          removeVirtualNode: unregisterNthVirtualNode,
        });
      } else {
        updateVirtualNodeRegistration({
          currentItems: allItems,
          previousItems: previousAllItemsList,
          addVirtualNode: registerNthVirtualNode,
          removeVirtualNode: unregisterNthVirtualNode,
        });
      }
    }
    previousAllItems.current = allItems;
    previousIndexOffset.current = indexOffset;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unfortunately, we can't have clean effects with lrud for now
  }, [allItems]);
};

const useRegisterVirtualNodes = <T,>({
  allItems,
  indexOffset,
  loop,
  orientation,
  isGrid,
}: {
  allItems: Array<T>;
  indexOffset: number;
  loop: boolean;
  orientation: NodeOrientation;
  isGrid: boolean;
}) => {
  const spatialNavigator = useSpatialNavigator();
  const parentId = useParentId();
  const getCachedNthVirtualNodeID = useCreateVirtualParentsIds(parentId);
  // When the list loops, indexes are unbounded: ids are not cached (the cache would grow forever)
  const loopIdPrefix = useMemo(() => uniqueId(`${parentId}_virtual_loop_`), [parentId]);
  const getNthVirtualNodeID = useCallback(
    (index: number) => (loop ? `${loopIdPrefix}_${index}` : getCachedNthVirtualNodeID(index)),
    [loop, loopIdPrefix, getCachedNthVirtualNodeID],
  );

  // invert the orientation of children in grids so we can register rows in columns in rows, etc...
  const nodeOrientation = isGrid ? invertOrientation(orientation) : 'vertical';

  const registerNthVirtualNode = useCallback(
    (index: number, childIndex?: number) => {
      return spatialNavigator.registerNode(getNthVirtualNodeID(index), {
        parent: parentId,
        orientation: nodeOrientation,
        isFocusable: false,
        // Position of the node among its siblings. Undefined: the node is appended.
        index: childIndex,
      });
    },
    [getNthVirtualNodeID, parentId, spatialNavigator, nodeOrientation],
  );

  const unregisterNthVirtualNode = useCallback(
    (index: number) => spatialNavigator.unregisterNode(getNthVirtualNodeID(index)),
    [getNthVirtualNodeID, spatialNavigator],
  );

  const setInitialActiveNode = useCallback(
    (index: number) => spatialNavigator.setActiveChild(parentId, getNthVirtualNodeID(index)),
    [spatialNavigator, parentId, getNthVirtualNodeID],
  );

  useRegisterInitialAndUnregisterFinalVirtualNodes({
    allItems,
    indexOffset,
    parentId,
    loop,
    setInitialActiveNode,
    registerNthVirtualNode,
    unregisterNthVirtualNode,
  });

  useUpdateRegistration({
    allItems,
    indexOffset,
    loop,
    registerNthVirtualNode,
    unregisterNthVirtualNode,
  });

  return { getNthVirtualNodeID };
};

const ItemWrapperWithVirtualParentContext = typedMemo(
  <T,>({
    virtualParentID,
    index,
    item,
    renderItem,
  }: {
    virtualParentID: string;
    item: T;
    index: number;
    renderItem: VirtualizedListProps<T>['renderItem'];
  }) => (
    <ParentIdContext.Provider value={virtualParentID}>
      {renderItem({ item, index: index })}
    </ParentIdContext.Provider>
  ),
);
ItemWrapperWithVirtualParentContext.displayName = 'ItemWrapperWithVirtualParentContext';

export type SpatialNavigationVirtualizedListWithVirtualNodesProps<T> = Omit<
  VirtualizedListProps<T>,
  'listSizeInPx'
> & {
  isGrid?: boolean;
};

export type SpatialNavigationVirtualizedListWithVirtualNodesRef = {
  getNthVirtualNodeID: (index: number) => string;
};

/**
 * This component wraps every item of the VirtualizedList inside a Virtual Node.
 *
 * Virtual Nodes make the list more resilient to data changes.
 *
 * If the data changes, virtual nodes always wrap each elements for the spatial navigator to never lose track of the elements.
 * The strategy is to have as many virtual LRUD nodes as the amount data. For a N length array, we have N virtualized nodes. Even after pagination.
 * These virtual nodes are really helpful to never lose track of the navigation, especially if there is a refresh of the data and the array is shuffled.
 * ```
 *                       ┌───────────────────────────────────────┐
 *                       │                Screen                 │
 *                       │                                       │
 *                       │                                       │
 * ┌─────┐  ┌─────┐  ┌───┼─┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐ │┌─────┐  ┌─────┐
 * │  1  │  │  2  │  │  3│ │  │  4  │  │  5  │  │  6  │  │  7  │ ││  8  │  │  9  │
 * │     │  │┌───┐│  │┌──┼┐│  │┌───┐│  │┌───┐│  │┌───┐│  │┌───┐│ ││┌───┐│  │     │
 * │  A  │  ││ B ││  ││ C│││  ││ D ││  ││ E ││  ││ F ││  ││ G ││ │││ H ││  │  I  │
 * │     │  │└───┘│  │└──┼┘│  │└───┘│  │└───┘│  │└───┘│  │└───┘│ ││└───┘│  │     │
 * └─────┘  └─────┘  └───┼─┘  └─────┘  └─────┘  └─────┘  └─────┘ │└─────┘  └─────┘
 *                       │                                       │
 *                       └───────────────────────────────────────┘
 * ```
 * Framed letters correspond to rendered components.
 */
export const SpatialNavigationVirtualizedListWithVirtualNodes = typedMemo(
  <T,>(
    props: SpatialNavigationVirtualizedListWithVirtualNodesProps<T> & {
      getNodeIdRef: React.Ref<SpatialNavigationVirtualizedListWithVirtualNodesRef>;
    },
  ) => {
    const { getNthVirtualNodeID } = useRegisterVirtualNodes({
      allItems: props.data,
      indexOffset: props.indexOffset ?? 0,
      loop: props.loop ?? false,
      orientation: props.orientation ?? 'horizontal',
      isGrid: props.isGrid ?? false,
    });

    useImperativeHandle(
      props.getNodeIdRef,
      () => ({
        getNthVirtualNodeID: getNthVirtualNodeID,
      }),
      [getNthVirtualNodeID],
    );

    const { renderItem } = props;
    const renderWrappedItem: typeof props.renderItem = useCallback(
      ({ item, index }) => (
        <ItemWrapperWithVirtualParentContext
          virtualParentID={getNthVirtualNodeID(index)}
          renderItem={renderItem}
          item={item}
          index={index}
        />
      ),
      [getNthVirtualNodeID, renderItem],
    );

    return <VirtualizedListWithSize {...props} renderItem={renderWrappedItem} />;
  },
);
SpatialNavigationVirtualizedListWithVirtualNodes.displayName =
  'SpatialNavigationVirtualizedListWithVirtualNodes';
