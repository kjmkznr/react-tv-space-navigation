type Range = { start: number; end: number };

/**
 * Same purpose as `updateVirtualNodeRegistration`, for a list whose items are identified by an absolute index
 * and where the registered range can move (items added or removed at the beginning or at the end).
 *
 * - Nodes added after the end are registered in ascending order (appended).
 * - Nodes added before the start are registered in ascending order with the `childIndex` they must be inserted at
 *   (0, 1, 2...), so that the order of the children is the order of the absolute indexes.
 * - Nodes that are not in the current range anymore are removed.
 * - Ranges that do not overlap are handled as "remove everything, then add everything".
 */
export const updateVirtualNodeRegistrationByRange = ({
  currentRange,
  previousRange,
  addVirtualNode,
  removeVirtualNode,
}: {
  currentRange: Range;
  previousRange: Range;
  addVirtualNode: (absoluteIndex: number, childIndex?: number) => void;
  removeVirtualNode: (absoluteIndex: number) => void;
}) => {
  const overlaps = currentRange.start < previousRange.end && previousRange.start < currentRange.end;

  if (!overlaps) {
    for (let index = previousRange.start; index < previousRange.end; index++) {
      removeVirtualNode(index);
    }
    for (let index = currentRange.start; index < currentRange.end; index++) {
      addVirtualNode(index);
    }
    return;
  }

  // Remove first: it keeps the number of registered nodes bounded during the update
  for (
    let index = previousRange.start;
    index < Math.min(currentRange.start, previousRange.end);
    index++
  ) {
    removeVirtualNode(index);
  }
  for (
    let index = Math.max(currentRange.end, previousRange.start);
    index < previousRange.end;
    index++
  ) {
    removeVirtualNode(index);
  }

  for (
    let index = currentRange.start;
    index < Math.min(previousRange.start, currentRange.end);
    index++
  ) {
    addVirtualNode(index, index - currentRange.start);
  }
  for (
    let index = Math.max(previousRange.end, currentRange.start);
    index < currentRange.end;
    index++
  ) {
    addVirtualNode(index);
  }
};
