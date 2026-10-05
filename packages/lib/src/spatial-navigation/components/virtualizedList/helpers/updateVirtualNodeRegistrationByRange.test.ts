import { updateVirtualNodeRegistrationByRange } from './updateVirtualNodeRegistrationByRange';

const run = (
  previousRange: { start: number; end: number },
  currentRange: { start: number; end: number },
) => {
  const added: Array<[number, number | undefined]> = [];
  const removed: number[] = [];
  updateVirtualNodeRegistrationByRange({
    previousRange,
    currentRange,
    addVirtualNode: (index, childIndex) => added.push([index, childIndex]),
    removeVirtualNode: (index) => removed.push(index),
  });
  return { added, removed };
};

describe('updateVirtualNodeRegistrationByRange', () => {
  it('does nothing when the range is the same', () => {
    expect(run({ start: 0, end: 5 }, { start: 0, end: 5 })).toEqual({ added: [], removed: [] });
  });

  it('appends new nodes at the end, in ascending order', () => {
    expect(run({ start: 0, end: 3 }, { start: 0, end: 6 })).toEqual({
      added: [
        [3, undefined],
        [4, undefined],
        [5, undefined],
      ],
      removed: [],
    });
  });

  it('prepends new nodes with the index they must be inserted at', () => {
    expect(run({ start: 0, end: 3 }, { start: -3, end: 3 })).toEqual({
      added: [
        [-3, 0],
        [-2, 1],
        [-1, 2],
      ],
      removed: [],
    });
  });

  it('removes nodes that left the range on both sides', () => {
    expect(run({ start: -3, end: 6 }, { start: 0, end: 3 })).toEqual({
      added: [],
      removed: [-3, -2, -1, 3, 4, 5],
    });
  });

  it('handles a shifted range', () => {
    expect(run({ start: 0, end: 4 }, { start: 2, end: 6 })).toEqual({
      added: [
        [4, undefined],
        [5, undefined],
      ],
      removed: [0, 1],
    });
  });

  it('removes everything then adds everything when ranges do not overlap', () => {
    expect(run({ start: 0, end: 2 }, { start: 10, end: 12 })).toEqual({
      added: [
        [10, undefined],
        [11, undefined],
      ],
      removed: [0, 1],
    });
  });
});
